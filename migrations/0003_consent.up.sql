-- Append-only KVKK consent log + published consent text versions.

CREATE TYPE consent_type AS ENUM (
  'aydinlatma_metni',
  'acik_riza_location',
  'terms_of_service'
);

-- Currently published text per consent purpose (one active row per type).
CREATE TABLE consent_versions (
  consent_type  consent_type PRIMARY KEY,
  version       TEXT NOT NULL,
  body_text     TEXT NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable consent event log: never UPDATE rows; withdrawal = INSERT granted=false.
CREATE TABLE consent_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users (id),
  consent_type     consent_type NOT NULL,
  consent_version  TEXT NOT NULL,
  granted          BOOLEAN NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address       INET,
  user_agent       TEXT
);

CREATE INDEX consent_events_user_type_created_idx
  ON consent_events (user_id, consent_type, created_at DESC);

INSERT INTO consent_versions (consent_type, version, body_text) VALUES
  (
    'aydinlatma_metni',
    'v1',
    'City Competition olarak kişisel verilerinizi KVKK kapsamında işlemekteyiz. Konum verileriniz oyun işlevleri (bölge fethi, yakınlık) için işlenir; saklama süresi ve haklarınız ayrıntılı aydınlatma metninde yer alır.'
  ),
  (
    'acik_riza_location',
    'v1',
    'Sürekli konum takibi için açık rızanızı veriyorsunuz. Bu rıza yalnızca konum tabanlı oyun özelliklerine yöneliktir; istediğiniz zaman geri çekebilirsiniz.'
  ),
  (
    'terms_of_service',
    'v1',
    'Hizmet şartlarını kabul ederek City Competition''ı kullanmayı kabul edersiniz.'
  );
