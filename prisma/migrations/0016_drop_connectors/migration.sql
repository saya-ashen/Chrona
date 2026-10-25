-- v2-8: kernel connectors are removed; outside sources become modules. Their tables held no data where deployed.
DROP TABLE "InboundItem";
DROP TABLE "Connector";
ALTER TABLE "ModuleRun" DROP COLUMN "inboundItemId";
