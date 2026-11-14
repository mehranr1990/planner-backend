BEGIN;
ALTER TABLE "Project" ADD COLUMN "key" varchar(32), ADD COLUMN "color" varchar(7);
ALTER TABLE "Project" ADD CONSTRAINT "Project_display_key_format" CHECK ("key" IS NULL OR "key" ~ '^[A-Za-z0-9-]{1,32}$');
ALTER TABLE "Project" ADD CONSTRAINT "Project_display_color_format" CHECK ("color" IS NULL OR "color" ~ '^#[A-Fa-f0-9]{6}$');
COMMIT;
