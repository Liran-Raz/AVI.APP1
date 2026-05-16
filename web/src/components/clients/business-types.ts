// Hebrew labels for the DB enum `business_type`. Kept in one place so the
// dropdown filter, the form field, and the table cell render the same text.

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

export function formatBusinessType(
  value: ClientDTO["businessType"],
): string {
  if (!value) return "—";
  return BUSINESS_TYPE_LABELS[value];
}
