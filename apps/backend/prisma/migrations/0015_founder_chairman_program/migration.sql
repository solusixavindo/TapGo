-- Add the single Founder Chairman role above Founder Platinum.
ALTER TYPE "FounderRole" ADD VALUE IF NOT EXISTS 'FOUNDER_CHAIRMAN';
