import { mutation } from "./_generated/server";
import { optionalUser, roleOf } from "./lib/helpers";

const SEED_KEY = "demo-network-v1";

const iso = (daysAhead: number) =>
  new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
const at = (daysAhead: number) => Date.now() + daysAhead * 86_400_000;

/**
 * Idempotent demo records. Every row carries isDemo: true and the UI labels it
 * as Demo Data. Nothing here is presented as live verified inventory.
 */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const seeded = await ctx.db
      .query("counters")
      .withIndex("by_key", (q) => q.eq("key", SEED_KEY))
      .unique();
    if (seeded) return { seeded: false, message: "Demo data is already loaded." };

    const now = Date.now();
    const rcPune = await ctx.db.insert("organizations", {
      orgId: "RC-DEMO-001",
      type: "red_cross",
      name: "Red Cross Society — Pune Branch (Demo)",
      contactPerson: "Demo Coordinator",
      phone: "02025501000",
      email: "pune.demo@redcross.example",
      address: "12 Camp Road, Pune",
      city: "Pune",
      area: "Camp",
      latitude: 18.5158,
      longitude: 73.8798,
      status: "verified",
      verifiedAt: now,
      verifiedBy: "Demo seed",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const rcMumbai = await ctx.db.insert("organizations", {
      orgId: "RC-DEMO-002",
      type: "red_cross",
      name: "Red Cross Society — Mumbai Branch (Demo)",
      contactPerson: "Demo Coordinator",
      phone: "02224901000",
      email: "mumbai.demo@redcross.example",
      address: "88 Marine Lines, Mumbai",
      city: "Mumbai",
      area: "Marine Lines",
      latitude: 19.076,
      longitude: 72.8777,
      status: "verified",
      verifiedAt: now,
      verifiedBy: "Demo seed",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const bloodBank = await ctx.db.insert("organizations", {
      orgId: "BB-DEMO-001",
      type: "blood_bank",
      name: "Sahyadri Blood Bank (Demo)",
      contactPerson: "Demo Blood Bank Officer",
      phone: "02025502000",
      email: "bank.demo@sahyadri.example",
      address: "4 JM Road, Pune",
      city: "Pune",
      area: "Deccan",
      latitude: 18.5196,
      longitude: 73.8409,
      status: "verified",
      verifiedAt: now,
      verifiedBy: "Demo seed",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const hospitalPune = await ctx.db.insert("organizations", {
      orgId: "HOSP-DEMO-001",
      type: "hospital",
      name: "Sassoon General Hospital (Demo)",
      contactPerson: "Demo Hospital Coordinator",
      phone: "02026128000",
      email: "hospital.demo@sassoon.example",
      address: "Sassoon Road, Pune",
      city: "Pune",
      area: "Agarkar Nagar",
      latitude: 18.5255,
      longitude: 73.8734,
      status: "verified",
      verifiedAt: now,
      verifiedBy: "Demo seed",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("organizations", {
      orgId: "HOSP-DEMO-002",
      type: "hospital",
      name: "KEM Hospital (Demo)",
      contactPerson: "Demo Hospital Coordinator",
      phone: "02224107000",
      email: "hospital.demo@kem.example",
      address: "Acharya Donde Marg, Mumbai",
      city: "Mumbai",
      area: "Parel",
      latitude: 19.0028,
      longitude: 72.8424,
      status: "verified",
      verifiedAt: now,
      verifiedBy: "Demo seed",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });

    const batches = [
      { org: rcPune, g: "O-", c: "red_cells", u: 4, exp: 22, coll: -14, low: 3, loc: "Cold room A · 2–6 °C" },
      { org: rcPune, g: "O+", c: "red_cells", u: 12, exp: 28, coll: -7, low: 5, loc: "Cold room A · 2–6 °C" },
      { org: rcPune, g: "A+", c: "red_cells", u: 2, exp: 9, coll: -25, low: 4, loc: "Cold room B · 2–6 °C" },
      { org: rcPune, g: "B+", c: "red_cells", u: 7, exp: 33, coll: -4, low: 3, loc: "Cold room B · 2–6 °C" },
      { org: rcPune, g: "AB-", c: "plasma", u: 5, exp: 140, coll: -20, low: 2, loc: "Freezer P · ≤ −25 °C" },
      { org: rcPune, g: "A+", c: "platelets", u: 3, exp: 4, coll: -1, low: 3, loc: "Agitator 1 · 20–24 °C" },
      { org: rcPune, g: "O-", c: "whole_blood", u: 1, exp: 5, coll: -16, low: 2, loc: "Cold room A · 2–6 °C" },
      { org: rcMumbai, g: "B-", c: "red_cells", u: 6, exp: 26, coll: -10, low: 3, loc: "Cold room M1" },
      { org: rcMumbai, g: "AB+", c: "plasma", u: 9, exp: 180, coll: -12, low: 3, loc: "Freezer M" },
      { org: bloodBank, g: "A-", c: "red_cells", u: 8, exp: 19, coll: -12, low: 3, loc: "Vault 1" },
      { org: bloodBank, g: "O+", c: "platelets", u: 2, exp: 3, coll: -2, low: 2, loc: "Agitator 2" },
      { org: bloodBank, g: "B+", c: "whole_blood", u: 10, exp: 30, coll: -5, low: 4, loc: "Vault 2" },
    ] as const;

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const inventoryId = await ctx.db.insert("inventory", {
        organizationId: batch.org,
        bloodGroup: batch.g,
        component: batch.c,
        unitsAvailable: batch.u,
        unitsReserved: batch.g === "O-" && batch.c === "red_cells" ? 1 : 0,
        collectionDate: iso(batch.coll),
        expiryDate: iso(batch.exp),
        storageLocation: batch.loc,
        batchRef: `DEMO-${String(index + 1).padStart(3, "0")}`,
        lowStockThreshold: batch.low,
        verified: true,
        lastUpdated: now,
        isDemo: true,
        createdAt: now,
      });
      await ctx.db.insert("inventoryTransactions", {
        inventoryId,
        organizationId: batch.org,
        type: "collection",
        units: batch.u,
        bloodGroup: batch.g,
        component: batch.c,
        actorRole: "demo",
        note: "Demo seed — not a live stock addition",
        isDemo: true,
        createdAt: now,
      });
    }

    const requestSeeds = [
      {
        requestId: "DEMO-REQ-001",
        status: "pending" as const,
        bloodGroup: "O-" as const,
        component: "red_cells" as const,
        units: 3,
        urgency: "emergency" as const,
        hours: 4,
        age: 46,
        reason:
          "Post-operative haemorrhage in the emergency unit. Cross-matched units requested urgently.",
        patientName: "Demo Patient A",
        patientRef: "DEMO-P-1042",
      },
      {
        requestId: "DEMO-REQ-002",
        status: "under_verification" as const,
        bloodGroup: "A+" as const,
        component: "platelets" as const,
        units: 2,
        urgency: "urgent" as const,
        hours: 20,
        age: 31,
        reason: "Dengue with severe thrombocytopenia; platelet support requested by the treating physician.",
        patientName: "Demo Patient B",
        patientRef: "DEMO-P-2277",
      },
      {
        requestId: "DEMO-REQ-003",
        status: "approved" as const,
        bloodGroup: "B+" as const,
        component: "red_cells" as const,
        units: 2,
        urgency: "urgent" as const,
        hours: 30,
        age: 58,
        reason: "Symptomatic anaemia requiring transfusion; haematology team has approved the request.",
        patientName: "Demo Patient C",
        patientRef: "DEMO-P-3391",
      },
      {
        requestId: "DEMO-REQ-004",
        status: "dispatched" as const,
        bloodGroup: "AB+" as const,
        component: "plasma" as const,
        units: 2,
        urgency: "routine" as const,
        hours: 12,
        age: 39,
        reason: "Plasma support for a patient under observation in the medical ICU.",
        patientName: "Demo Patient D",
        patientRef: "DEMO-P-4410",
      },
      {
        requestId: "DEMO-REQ-005",
        status: "fulfilled" as const,
        bloodGroup: "A-" as const,
        component: "red_cells" as const,
        units: 1,
        urgency: "routine" as const,
        hours: -48,
        age: 24,
        reason: "Elective procedure completed with one unit transfused under supervision.",
        patientName: "Demo Patient E",
        patientRef: "DEMO-P-5590",
      },
    ];

    for (const seed of requestSeeds) {
      const id = await ctx.db.insert("bloodRequests", {
        requestId: seed.requestId,
        source: "hospital",
        patientName: seed.patientName,
        patientRef: seed.patientRef,
        patientAge: seed.age,
        requestorName: "Demo Hospital Coordinator",
        requestorType: "representative",
        requesterPhone: "02026128000",
        requesterEmail: "hospital.demo@sassoon.example",
        hospitalName: "Sassoon General Hospital (Demo)",
        hospitalOrgId: hospitalPune,
        city: "Pune",
        area: "Agarkar Nagar",
        bloodGroup: seed.bloodGroup,
        component: seed.component,
        units: seed.units,
        requiredBy: at(seed.hours / 24),
        urgency: seed.urgency,
        reason: seed.reason,
        doctorName: "Dr. Demo Rao",
        doctorContact: "02026128001",
        consent: true,
        status: seed.status,
        assignedOrgId: ["approved", "dispatched", "fulfilled"].includes(seed.status)
          ? rcPune
          : undefined,
        verifiedById: undefined,
        verifiedAt: ["approved", "dispatched", "fulfilled"].includes(seed.status)
          ? now - 3 * 3_600_000
          : undefined,
        isDemo: true,
        createdAt: now - (seed.hours > 0 ? 3 : 48) * 3_600_000,
        updatedAt: now - 3_600_000,
      });
      const history: {
        status: typeof seed.status;
        note: string;
        actorRole: string;
        offset: number;
      }[] = [
        { status: "pending", actorRole: "hospital", note: "Demo request submitted.", offset: -6 },
      ];
      if (seed.status === "under_verification") {
        history.push({
          status: "under_verification",
          actorRole: "red_cross",
          note: "Demo document review started.",
          offset: -4,
        });
      }
      if (["approved", "dispatched", "fulfilled"].includes(seed.status)) {
        history.push(
          { status: "under_verification", actorRole: "red_cross", note: "Demo verification in progress.", offset: -5 },
          { status: "approved", actorRole: "red_cross", note: "Demo stock reserved by Red Cross Pune.", offset: -3 },
        );
      }
      if (seed.status === "dispatched") {
        history.push({
          status: "dispatched",
          actorRole: "red_cross",
          note: "Demo dispatch recorded; awaiting hospital receipt.",
          offset: -1,
        });
      }
      if (seed.status === "fulfilled") {
        history.push({
          status: "fulfilled",
          actorRole: "red_cross",
          note: "Demo request fulfilled and receipt confirmed.",
          offset: -1,
        });
      }
      for (const item of history) {
        await ctx.db.insert("requestStatusHistory", {
          requestId: id,
          status: item.status,
          actorRole: item.actorRole,
          note: item.note,
          isDemo: true,
          createdAt: now + item.offset * 3_600_000,
        });
      }
    }

    await ctx.db.insert("bloodCamps", {
      organizationId: rcPune,
      title: "Camp Road Community Donation Drive (Demo)",
      description:
        "Walk-in and pre-registered donors. Photo ID required. Refreshments provided. Final eligibility is assessed by medical staff on site.",
      venue: "Camp Road Community Hall",
      city: "Pune",
      date: iso(9),
      startTime: "09:00",
      endTime: "15:00",
      capacity: 80,
      organizer: "Red Cross Society — Pune Branch (Demo)",
      status: "upcoming",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("bloodCamps", {
      organizationId: bloodBank,
      title: "Sahyadri Blood Bank Weekend Drive (Demo)",
      description:
        "Weekend donation camp with platelet-apheresis information desk. Appointments preferred; walk-ins subject to capacity.",
      venue: "Sahyadri Blood Bank Atrium",
      city: "Pune",
      date: iso(18),
      startTime: "10:00",
      endTime: "16:00",
      capacity: 50,
      organizer: "Sahyadri Blood Bank (Demo)",
      status: "upcoming",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("bloodCamps", {
      organizationId: rcMumbai,
      title: "Marine Lines Donor Meet (Demo)",
      description:
        "Community awareness and donation camp. Medical screening on site. Pre-registration recommended.",
      venue: "Marine Lines Community Centre",
      city: "Mumbai",
      date: iso(24),
      startTime: "09:30",
      endTime: "14:30",
      capacity: 60,
      organizer: "Red Cross Society — Mumbai Branch (Demo)",
      status: "upcoming",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorRole: "system",
      action: "demo.seeded",
      entityType: "demo",
      entityId: SEED_KEY,
      detail: "Demo network data loaded (organizations, inventory, requests, camps).",
      isDemo: true,
      createdAt: now,
    });
    await ctx.db.insert("counters", { key: SEED_KEY, value: 1 });

    const user = await optionalUser(ctx);
    if (user) {
      await ctx.db.insert("notifications", {
        userId: user._id,
        title: "Demo network loaded",
        body: "Demo organizations, stock, requests and camps are now visible. Demo Data is labelled everywhere and is not live inventory.",
        kind: "system",
        link: "/blood-search",
        read: false,
        createdAt: Date.now(),
      });
      await ctx.db.insert("auditLogs", {
        actorUserId: user._id,
        actorRole: roleOf(user),
        action: "demo.loaded",
        entityType: "demo",
        entityId: SEED_KEY,
        detail: "Signed-in user loaded the demo network.",
        isDemo: true,
        createdAt: Date.now(),
      });
    }

    return { seeded: true, message: "Demo network data loaded and labelled." };
  },
});
