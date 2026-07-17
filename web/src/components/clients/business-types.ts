// Hebrew labels for the DB enum `business_type`. The clients screen now renders
// these through the i18n catalog (`businessType.*` keys); this map is retained
// because the invoicing business-profile (ledger-settings) still consumes it
// directly to label the selected business type.

import type { ClientDTO } from "@/lib/api-client";

export const BUSINESS_TYPE_LABELS: Record<
  NonNullable<ClientDTO["businessType"]>,
  string
> = {
  patur: "עוסק פטור",
  murshe: "עוסק מורשה",
  ltd: "חברה בע״מ",
  amuta: "עמותה",
  agudat_shitufit: "אגודה שיתופית",
};
