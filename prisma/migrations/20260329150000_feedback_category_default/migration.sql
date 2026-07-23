-- Align DB default with app categories
ALTER TABLE "UserFeedback" ALTER COLUMN "category" SET DEFAULT 'general_issue';
