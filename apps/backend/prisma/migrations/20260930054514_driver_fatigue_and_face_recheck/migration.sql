-- AlterTable
ALTER TABLE "driver_face_checks" ADD COLUMN     "recheck_due_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ride_driver_profiles" ADD COLUMN     "online_since" TIMESTAMP(3);
