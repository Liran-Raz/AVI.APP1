import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullSession } from "@/server/auth/session";
import type { Ledger, UserRole } from "@/server/db/domain.types";
import { ForbiddenError, NotFoundError } from "@/server/errors/app-error";

vi.mock("@/server/repositories/ledgers.repository", () => ({
  findManyByOrgId: vi.fn(),
  findSelfByOrgId: vi.fn(),
  findByIdAndOrgId: vi.fn(),
  updateByIdAndOrgId: vi.fn(),
}));

import * as ledgersRepo from "@/server/repositories/ledgers.repository";
import {
  getSelfLedger,
  listLedgers,
  updateLedger,
} from "@/server/services/ledgers.service";

const ORG = "org-1";
const ME = "user-me";
const LEDGER_ID = "11111111-1111-4111-8111-111111111111";

function session(role: UserRole = "owner"): FullSession {
  return {
    user: { id: ME },
    profile: { id: ME, role, full_name: "אני", email: "me@x.test" },
    organization: { id: ORG, name: "משרד" },
    activeOrg: { id: ORG, name: "משרד" },
    activeRole: role,
  } as unknown as FullSession;
}

function ledgerRow(o: Partial<Ledger> = {}): Ledger {
  return {
    id: LEDGER_ID,
    org_id: ORG,
    client_id: null,
    is_self: true,
    legal_name: "משרד רו״ח לדוגמה",
    trade_name: null,
    business_id: null,
    business_type: null,
    address_street: null,
    address_city: null,
    address_zip: null,
    phone: null,
    email: null,
    logo_url: null,
    bookkeeping_managed: false,
    currency: "ILS",
    created_at: "2026-07-16T10:00:00.000Z",
    updated_at: "2026-07-16T10:00:00.000Z",
    ...o,
  } as Ledger;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ledgersRepo.findSelfByOrgId).mockResolvedValue(ledgerRow());
  vi.mocked(ledgersRepo.findManyByOrgId).mockResolvedValue([ledgerRow()]);
  vi.mocked(ledgersRepo.findByIdAndOrgId).mockResolvedValue(ledgerRow());
  vi.mocked(ledgersRepo.updateByIdAndOrgId).mockImplementation(
    async (_id, _org, patch) => ledgerRow(patch as Partial<Ledger>),
  );
});

describe("getSelfLedger", () => {
  it("returns the self-ledger DTO (snake→camel, org_id stripped)", async () => {
    const dto = await getSelfLedger(session("employee"));
    expect(ledgersRepo.findSelfByOrgId).toHaveBeenCalledWith(ORG);
    expect(dto.id).toBe(LEDGER_ID);
    expect(dto.legalName).toBe("משרד רו״ח לדוגמה");
    expect(dto.isSelf).toBe(true);
    expect("org_id" in dto).toBe(false);
    expect("orgId" in dto).toBe(false);
  });

  it("issueReady is false without business_id and true with it", async () => {
    expect((await getSelfLedger(session())).issueReady).toBe(false);

    vi.mocked(ledgersRepo.findSelfByOrgId).mockResolvedValue(
      ledgerRow({ business_id: "123456789" }),
    );
    expect((await getSelfLedger(session())).issueReady).toBe(true);
  });

  it("fails loudly when the self-ledger is missing (migration not applied)", async () => {
    vi.mocked(ledgersRepo.findSelfByOrgId).mockResolvedValue(null);
    await expect(getSelfLedger(session())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("listLedgers", () => {
  it("lists org ledgers for any role with ledgers.view", async () => {
    const items = await listLedgers(session("employee"));
    expect(ledgersRepo.findManyByOrgId).toHaveBeenCalledWith(ORG);
    expect(items).toHaveLength(1);
    expect(items[0].legalName).toBe("משרד רו״ח לדוגמה");
  });
});

describe("updateLedger", () => {
  it("owner updates the business profile (camel→snake, only provided keys)", async () => {
    const dto = await updateLedger(session("owner"), LEDGER_ID, {
      legalName: "שם חדש",
      businessId: "123456789",
    });
    expect(ledgersRepo.updateByIdAndOrgId).toHaveBeenCalledWith(
      LEDGER_ID,
      ORG,
      { legal_name: "שם חדש", business_id: "123456789" },
    );
    expect(dto.legalName).toBe("שם חדש");
    expect(dto.businessId).toBe("123456789");
    expect(dto.issueReady).toBe(true);
  });

  it("maps null clears (tradeName: null → trade_name: null)", async () => {
    await updateLedger(session("owner"), LEDGER_ID, { tradeName: null });
    expect(ledgersRepo.updateByIdAndOrgId).toHaveBeenCalledWith(
      LEDGER_ID,
      ORG,
      { trade_name: null },
    );
  });

  it("DENIES a Manager (admin) — ledgers.manage is owner-only", async () => {
    await expect(
      updateLedger(session("admin"), LEDGER_ID, { legalName: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(ledgersRepo.updateByIdAndOrgId).not.toHaveBeenCalled();
  });

  it("DENIES an employee", async () => {
    await expect(
      updateLedger(session("employee"), LEDGER_ID, { legalName: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(ledgersRepo.updateByIdAndOrgId).not.toHaveBeenCalled();
  });

  it("404s on a ledger outside the org (repo returns null)", async () => {
    vi.mocked(ledgersRepo.findByIdAndOrgId).mockResolvedValue(null);
    await expect(
      updateLedger(session("owner"), LEDGER_ID, { legalName: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(ledgersRepo.updateByIdAndOrgId).not.toHaveBeenCalled();
  });
});
