-- Optional provider assistance is off until the person explicitly opts in.
ALTER TABLE everrate.users ADD COLUMN ai_enabled boolean NOT NULL DEFAULT false;
