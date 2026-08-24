import { describe, expect, it } from "vitest";

import {
  normalizeStructureName,
  wouldCreateManagerCycle,
} from "@/modules/organization-structure/organization-structure";
import {
  departmentCreateSchema,
  departmentDeleteSchema,
  memberStructureSchema,
  teamCreateSchema,
  teamDeleteSchema,
  teamMemberAssignmentSchema,
} from "@/modules/organization-structure/schemas/organization-structure";

const memberA = "11111111-1111-4111-8111-111111111111";
const memberB = "22222222-2222-4222-8222-222222222222";
const memberC = "33333333-3333-4333-8333-333333333333";

describe("organization structure validation", () => {
  it("normalizes department codes and optional values", () => {
    expect(
      departmentCreateSchema.parse({ name: "  Client Delivery ", code: " delivery " }),
    ).toEqual({
      name: "Client Delivery",
      code: "DELIVERY",
    });
    expect(teamCreateSchema.parse({ name: " Launch Team ", description: " " })).toEqual({
      name: "Launch Team",
      description: null,
    });
  });

  it("rejects a self manager assignment", () => {
    const result = memberStructureSchema.safeParse({
      membershipId: memberA,
      departmentId: "",
      managerMembershipId: memberA,
    });
    expect(result.success).toBe(false);
  });

  it("accepts explicit department and team delete identifiers", () => {
    expect(departmentDeleteSchema.parse({ departmentId: memberA })).toEqual({
      departmentId: memberA,
    });
    expect(teamDeleteSchema.parse({ teamId: memberB })).toEqual({ teamId: memberB });
  });

  it("parses checkbox lead values", () => {
    expect(
      teamMemberAssignmentSchema.parse({
        teamId: memberA,
        membershipId: memberB,
        isLead: "on",
      }).isLead,
    ).toBe(true);
  });
});

describe("manager relationship rules", () => {
  const lines = [
    { membershipId: memberA, managerMembershipId: memberB },
    { membershipId: memberB, managerMembershipId: memberC },
    { membershipId: memberC, managerMembershipId: null },
  ];

  it("detects direct and indirect cycles", () => {
    expect(wouldCreateManagerCycle(lines, memberC, memberA)).toBe(true);
    expect(wouldCreateManagerCycle(lines, memberA, memberA)).toBe(true);
  });

  it("allows a valid reporting change", () => {
    expect(wouldCreateManagerCycle(lines, memberA, memberC)).toBe(false);
    expect(wouldCreateManagerCycle(lines, memberA, null)).toBe(false);
  });

  it("collapses repeated whitespace in names", () => {
    expect(normalizeStructureName("  Client   Delivery  ")).toBe("Client Delivery");
  });
});
