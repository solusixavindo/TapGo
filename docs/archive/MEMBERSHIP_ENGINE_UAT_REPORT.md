# TapGo Membership Engine UAT Report

Date: 2026-06-11  
Target API: `https://api.tapgolion.id`  
Scope: UAT Phase A.4 - Membership Engine

## Execution Mode

Audit mode: read-only production validation.  
No code changes, no migration, no deploy, no APK build, no production data mutation.

## Public Package Endpoint Evidence

Endpoint:

```http
GET https://api.tapgolion.id/api/v1/membership/packages
```

Result: PASS, HTTP 200.

Observed package summary:

| Tier | Price | directBonus | activeLevels | ppobBalance | Benefit metadata |
| --- | ---: | ---: | ---: | ---: | --- |
| BASIC | 0 | 2000 | 0 | 0 | BPJS `Tidak termasuk`, merchandise `[]`, businessRight `Akses pengguna` |
| SILVER | 500000 | 0 | 10 | 0 | `bpjsBenefit=null`, `merchandise=null`, `businessRight=null` |
| GOLD | 3000000 | 0 | 10 | 0 | `bpjsBenefit=null`, `merchandise=null`, `businessRight=null` |
| PLATINUM | 5500000 | 0 | 10 | 0 | `bpjsBenefit=null`, `merchandise=null`, `businessRight=null` |

Level benefit rates exposed:

- Silver/Gold/Platinum expose levels 1-10 with `8,4,2,2,2,1,1,1,1,1`.

## Rule Validation

| Rule | Expected | Actual | Status |
| --- | --- | --- | --- |
| Basic package exists | Price Rp0 | Price `0` | PASS |
| Silver price | Rp500.000 | `500000` | PASS |
| Gold price | Rp3.000.000 | `3000000` | PASS |
| Platinum price | Rp5.500.000 | `5500000` | PASS |
| Silver PPOB | Rp100.000 | `ppobBalance=0` in package endpoint | FAIL |
| Gold PPOB | Rp600.000 | `ppobBalance=0` in package endpoint | FAIL |
| Platinum PPOB | Rp1.000.000 | `ppobBalance=0` in package endpoint | FAIL |
| Silver benefits | Kaos, PPOB, BPJS JKK/JKM | Metadata null in package endpoint | FAIL |
| Gold benefits | Kaos, Jaket, Banner, PPOB, BPJS JKK/JKM | Metadata null in package endpoint | FAIL |
| Platinum benefits | Kaos, Jaket, PPOB, BPJS JKK/JKM/JHT | Metadata null in package endpoint | FAIL |
| Invoice terbentuk | Requires order creation | Not executed to avoid production mutation | BLOCKED |
| Membership order pending | Requires order creation | Not executed | BLOCKED |
| Paid status | Requires payment or callback | Not executed | BLOCKED |
| Membership active after paid | Requires payment or callback | Not executed | BLOCKED |

## Critical Observation

Production package endpoint currently exposes `ppobBalance=0` for Silver, Gold, and Platinum.

Impact:

- If membership activation uses the package `ppobBalance` from production DB, upgraded members may not receive the required PPOB benefit.
- If another service layer overrides PPOB amount internally, the public package endpoint is still misleading and fails UAT documentation/verification.

Severity: P1 Major, potentially P0 Critical if activation also credits `0`.

## Membership Engine UAT Result

Overall status: FAIL / BLOCKED.

Passing:

- Health endpoint.
- Public package endpoint.
- Package prices.

Failing:

- Package PPOB benefit metadata on production endpoint.
- Package benefit metadata for Silver/Gold/Platinum.

Blocked:

- Order, invoice, payment, and activation cannot be tested without approved UAT account and permission to create production UAT transactions.
