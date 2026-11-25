CREATE TABLE "supplier_profile" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "legal_name" TEXT NOT NULL,
    CONSTRAINT "supplier_profile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_profile_single_seller" CHECK ("id" = 1),
    CONSTRAINT "supplier_profile_name_present" CHECK (btrim("legal_name") <> '')
);
