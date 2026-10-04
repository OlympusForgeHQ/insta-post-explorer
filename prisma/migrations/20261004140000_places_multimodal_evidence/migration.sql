-- Add the evidence kinds consumed by the Places multimodal handler.
-- Existing rows, constraints and audit triggers remain unchanged.
ALTER TYPE "PlaceEvidenceType" ADD VALUE IF NOT EXISTS 'AUDIO_TRANSCRIPT';
ALTER TYPE "PlaceEvidenceType" ADD VALUE IF NOT EXISTS 'VIDEO_OCR';
ALTER TYPE "PlaceEvidenceType" ADD VALUE IF NOT EXISTS 'VISUAL_LANDMARK';
