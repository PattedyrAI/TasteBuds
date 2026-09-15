-- Profile labels are separate from trusted Discord identities and historical ownership.
ALTER TABLE everrate.users ADD COLUMN nickname text;
ALTER TABLE everrate.users ADD CONSTRAINT users_nickname_check CHECK (
  nickname IS NULL OR (
    char_length(nickname) BETWEEN 1 AND 40
    AND nickname = btrim(nickname)
    AND nickname !~ U&'[[:cntrl:]\2028\2029]'
  )
);
