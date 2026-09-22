-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "address" VARCHAR(255),
ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "emergency_contact_name" VARCHAR(120),
ADD COLUMN     "emergency_contact_phone" VARCHAR(20),
ADD COLUMN     "full_name" VARCHAR(120);

-- AlterTable
ALTER TABLE "ride_driver_applications" ADD COLUMN     "declaration_accepted_at" TIMESTAMP(3);
