-- Add graphic_designer to the UserRole enum so it can be picked from
-- the Role dropdown in Edit Profile / Admin → Users.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'graphic_designer' AFTER 'editor';
