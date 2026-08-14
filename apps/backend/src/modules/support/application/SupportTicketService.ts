import {
  Prisma,
  PrismaClient,
  SupportTicketCategory,
  SupportTicketStatus,
  UserRole,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma.js";
import { AppError } from "../../../core/errors/AppError.js";

const TICKET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type SupportTicketWithMessages = Prisma.SupportTicketGetPayload<{
  include: { messages: true };
}> & {
  user?: {
    id: string;
    fullName: string;
    phone: string;
    email: string | null;
  } | null;
};

export class SupportTicketService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async createTicket(input: {
    userId: string;
    category: SupportTicketCategory;
    subject: string;
    message: string;
  }) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const now = new Date();
        return await this.db.$transaction(async (tx) => {
          const ticket = await tx.supportTicket.create({
            data: {
              userId: input.userId,
              reference: this.generateReference(),
              category: input.category,
              subject: input.subject,
              lastMessageAt: now,
              messages: {
                create: {
                  authorId: input.userId,
                  authorRole: "USER",
                  body: input.message,
                },
              },
            },
            include: { messages: { orderBy: { createdAt: "asc" } } },
          });

          await tx.auditLog.create({
            data: {
              actorId: input.userId,
              action: "SUPPORT_TICKET_CREATED",
              entityType: "SupportTicket",
              entityId: ticket.id,
              metadata: {
                reference: ticket.reference,
                category: ticket.category,
              },
            },
          });

          return this.formatTicket(ticket);
        });
      } catch (error) {
        if (this.isUniqueConstraint(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new AppError(
      "Tiket bantuan belum dapat dibuat. Silakan coba lagi.",
      StatusCodes.CONFLICT,
      "SUPPORT_REFERENCE_RETRY_EXHAUSTED",
    );
  }

  async listUserTickets(userId: string) {
    const tickets = await this.db.supportTicket.findMany({
      where: { userId },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      include: { messages: { orderBy: { createdAt: "asc" } } },
      take: 50,
    });
    return tickets.map((ticket) => this.formatTicket(ticket));
  }

  async getUserTicket(userId: string, ticketId: string) {
    const ticket = await this.db.supportTicket.findFirst({
      where: { id: ticketId, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!ticket) {
      throw new AppError("Tiket tidak ditemukan.", StatusCodes.NOT_FOUND, "SUPPORT_TICKET_NOT_FOUND");
    }
    return this.formatTicket(ticket);
  }

  async listAdminTickets(status?: SupportTicketStatus) {
    const tickets = await this.db.supportTicket.findMany({
      where: status ? { status } : {},
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      include: {
        user: { select: { id: true, fullName: true, phone: true, email: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
      take: 100,
    });
    return tickets.map((ticket) => this.formatTicket(ticket, true));
  }

  async getAdminTicket(ticketId: string) {
    const ticket = await this.db.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { id: true, fullName: true, phone: true, email: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!ticket) {
      throw new AppError("Tiket tidak ditemukan.", StatusCodes.NOT_FOUND, "SUPPORT_TICKET_NOT_FOUND");
    }
    return this.formatTicket(ticket, true);
  }

  async updateAdminTicket(input: {
    ticketId: string;
    adminId: string;
    adminRole: UserRole;
    status?: SupportTicketStatus;
    message?: string;
  }) {
    const now = new Date();
    const ticket = await this.db.$transaction(async (tx) => {
      const existing = await tx.supportTicket.findUnique({
        where: { id: input.ticketId },
      });
      if (!existing) {
        throw new AppError("Tiket tidak ditemukan.", StatusCodes.NOT_FOUND, "SUPPORT_TICKET_NOT_FOUND");
      }

      const nextStatus = input.status ?? existing.status;
      const updated = await tx.supportTicket.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          lastMessageAt: input.message ? now : existing.lastMessageAt,
          ...(nextStatus === "RESOLVED" && existing.resolvedAt == null
            ? { resolvedAt: now }
            : {}),
          ...(nextStatus === "CLOSED" && existing.closedAt == null
            ? { closedAt: now }
            : {}),
          ...(input.message
            ? {
                messages: {
                  create: {
                    authorId: input.adminId,
                    authorRole: "ADMIN",
                    body: input.message,
                  },
                },
              }
            : {}),
        },
        include: {
          user: { select: { id: true, fullName: true, phone: true, email: true } },
          messages: { orderBy: { createdAt: "asc" } },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: input.adminId,
          action: "SUPPORT_TICKET_UPDATED",
          entityType: "SupportTicket",
          entityId: existing.id,
          metadata: {
            previousStatus: existing.status,
            nextStatus,
            adminRole: input.adminRole,
            responseAdded: Boolean(input.message),
          },
        },
      });

      return updated;
    });

    return this.formatTicket(ticket, true);
  }

  private formatTicket(
    ticket: SupportTicketWithMessages,
    includeUser = false,
  ) {
    return {
      id: ticket.id,
      reference: ticket.reference,
      category: ticket.category,
      subject: ticket.subject,
      status: ticket.status,
      lastMessageAt: ticket.lastMessageAt,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      ...(ticket.resolvedAt ? { resolvedAt: ticket.resolvedAt } : {}),
      ...(ticket.closedAt ? { closedAt: ticket.closedAt } : {}),
      ...(includeUser && "user" in ticket
        ? {
            user: ticket.user
              ? {
                  id: ticket.user.id,
                  fullName: ticket.user.fullName,
                  phone: this.maskPhone(ticket.user.phone),
                  email: ticket.user.email,
                }
              : null,
          }
        : {}),
      messages: ticket.messages.map((message) => ({
        id: message.id,
        authorRole: message.authorRole,
        body: message.body,
        createdAt: message.createdAt,
      })),
    };
  }

  private generateReference() {
    const bytes = randomBytes(7);
    let suffix = "";
    for (const byte of bytes) {
      suffix += TICKET_ALPHABET[byte % TICKET_ALPHABET.length];
    }
    return `TGS-${suffix}`;
  }

  private maskPhone(phone: string) {
    if (phone.length <= 4) {
      return "****";
    }
    return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
  }

  private isUniqueConstraint(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }
}
