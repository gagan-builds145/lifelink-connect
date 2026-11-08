import { mutation } from "./_generated/server";
import { optionalUser, roleOf } from "./lib/helpers";
import { payloadMassKg, planDroneRoute } from "../lib/supply";

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

    /* -------------------------------------------------------------- *
     * Autonomous supply-chain demo: transfer policy, agreements, mock
     * integration, fleet, airspace, demand history and one closed mission.
     * Everything below is labelled demo/simulated.
     * -------------------------------------------------------------- */
    for (const orgId of [rcPune, bloodBank]) {
      await ctx.db.patch(orgId, {
        transferAuthorized: true,
        autoAllocate: true,
        protectedReserveDefault: 1,
        searchRadiusKm: 75,
        updatedAt: now,
      });
    }
    await ctx.db.patch(hospitalPune, {
      transferAuthorized: true,
      autoAllocate: false,
      protectedReserveDefault: 1,
      updatedAt: now,
    });

    await ctx.db.insert("transferAgreements", {
      requestingOrgId: hospitalPune,
      supplyingOrgId: rcPune,
      status: "active",
      autoAllocate: true,
      maxUnitsPerRequest: 6,
      note: "Demo pre-authorised transfer agreement. Emergency release still needs staff confirmation.",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("transferAgreements", {
      requestingOrgId: hospitalPune,
      supplyingOrgId: bloodBank,
      status: "active",
      autoAllocate: true,
      maxUnitsPerRequest: 4,
      note: "Demo pre-authorised transfer agreement with a licensed blood bank.",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("facilityIntegrations", {
      organizationId: rcPune,
      kind: "blood_bank_api",
      label: "Red Cross Pune inventory adapter (MOCK)",
      authScheme: "api_key",
      credentialEnvVar: "RC_PUNE_INVENTORY_API_KEY",
      syncMode: "periodic",
      status: "connected",
      isMock: true,
      lastSyncStatus: "never",
      configNote:
        "Mock adapter for development. Records it imports are always flagged as demo data. Register a live adapter with a real endpoint and key before production.",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("facilityIntegrations", {
      organizationId: bloodBank,
      kind: "hms_api",
      label: "Sahyadri Blood Bank HMS bridge (MOCK)",
      authScheme: "bearer",
      credentialEnvVar: "SAHYADRI_HMS_TOKEN",
      syncMode: "manual",
      status: "connected",
      isMock: true,
      lastSyncStatus: "never",
      configNote:
        "Mock HMS bridge. Live sync expects GET {baseUrl}/inventory returning records and fails loudly when credentials are absent.",
      createdAt: now,
      updatedAt: now,
    });

    const demoBaseId = await ctx.db.insert("droneBases", {
      organizationId: rcPune,
      name: "Red Cross Pune drone base (Simulated)",
      city: "Pune",
      latitude: 18.5158,
      longitude: 73.8798,
      status: "active",
      createdAt: now,
    });
    await ctx.db.insert("drones", {
      droneId: "DRN-DEMO-001",
      baseId: demoBaseId,
      organizationId: rcPune,
      model: "AeroMed S2 (Simulated)",
      manufacturer: "LifeLink SITL Lab",
      maxPayloadKg: 4,
      batteryCapacityWh: 420,
      maxRangeKm: 32,
      cruiseSpeedKmh: 54,
      batteryPct: 94,
      status: "available",
      flightController: "px4",
      linkStatus: "online",
      gpsAvailable: true,
      maintenanceStatus: "ok",
      containerReady: true,
      containerTempC: 4,
      currentLat: 18.5158,
      currentLng: 73.8798,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("drones", {
      droneId: "DRN-DEMO-002",
      baseId: demoBaseId,
      organizationId: rcPune,
      model: "AeroMed S2-LR (Simulated)",
      manufacturer: "LifeLink SITL Lab",
      maxPayloadKg: 6,
      batteryCapacityWh: 680,
      maxRangeKm: 54,
      cruiseSpeedKmh: 58,
      batteryPct: 68,
      status: "charging",
      flightController: "ardupilot",
      linkStatus: "online",
      gpsAvailable: true,
      maintenanceStatus: "due",
      containerReady: true,
      containerTempC: 4,
      currentLat: 18.5158,
      currentLng: 73.8798,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("airspaceZones", {
      name: "Pune airfield control area (Simulated)",
      kind: "restricted",
      centerLat: 18.582,
      centerLng: 73.919,
      radiusKm: 2.4,
      source: "simulated",
      active: true,
      note: "Simulated restriction used to exercise preflight route checks. Not an authoritative airspace dataset.",
      createdAt: now,
    });

    // Historical issues are demo transactions behind a non-allocatable batch so
    // no fake units become available for reservation.
    const historyBatchId = await ctx.db.insert("inventory", {
      organizationId: hospitalPune,
      bloodGroup: "O+",
      component: "red_cells",
      unitsAvailable: 0,
      unitsReserved: 0,
      collectionDate: iso(-90),
      expiryDate: iso(60),
      storageLocation: "Demo demand history (not allocatable)",
      batchRef: "DEMO-HISTORY",
      lowStockThreshold: 3,
      verified: false,
      screened: false,
      released: false,
      protectedReserve: 0,
      lastUpdated: now,
      isDemo: true,
      createdAt: now,
    });
    for (let day = 59; day >= 0; day -= 1) {
      const weekday = new Date(now - day * 86_400_000).getUTCDay();
      const seasonal = weekday === 1 ? 3 : weekday === 5 ? 2 : 0;
      const wave = Math.round(2 * Math.sin(day / 5));
      const spike = day === 21 || day === 22 || day === 41 ? 7 : 0;
      const units = Math.max(0, 4 + seasonal + wave + spike);
      if (units === 0) continue;
      await ctx.db.insert("inventoryTransactions", {
        inventoryId: historyBatchId,
        organizationId: hospitalPune,
        type: "dispatch",
        units,
        bloodGroup: "O+",
        component: "red_cells",
        actorRole: "demo",
        note: "Demo demand history — not a live dispatch",
        isDemo: true,
        createdAt: now - day * 86_400_000,
      });
    }

    const demoUser = await ctx.db.query("users").first();
    if (demoUser) {
      const route = planDroneRoute({
        pickup: { lat: 18.5158, lng: 73.8798 },
        dropoff: { lat: 18.5255, lng: 73.8734 },
        pickupLabel: "Red Cross Pune landing zone",
        dropoffLabel: "Sassoon General Hospital landing zone",
      });
      const transferId = await ctx.db.insert("transfers", {
        transferId: "TRF-DEMO-001",
        requestingOrgId: hospitalPune,
        supplyingOrgId: rcPune,
        bloodGroup: "O-",
        component: "red_cells",
        units: 2,
        status: "received",
        reservationIds: [],
        auto: true,
        note: "Closed demo transfer for the simulated mission history.",
        createdAt: now - 2 * 86_400_000,
        updatedAt: now - 2 * 86_400_000 + 3_600_000,
        dispatchedAt: now - 2 * 86_400_000 + 600_000,
        receivedAt: now - 2 * 86_400_000 + 3_600_000,
      });
      const demoMissionId = await ctx.db.insert("droneMissions", {
        missionId: "DRM-DEMO-001",
        transferId,
        droneId: (await ctx.db.query("drones").first())!._id,
        pickupOrgId: rcPune,
        dropoffOrgId: hospitalPune,
        bloodGroup: "O-",
        component: "red_cells",
        units: 2,
        payloadKg: payloadMassKg(2),
        state: "COMPLETED",
        simulated: true,
        route: route.waypoints,
        outboundKm: route.outboundKm,
        returnKm: route.returnKm,
        totalKm: route.totalKm,
        preflight: [],
        preflightPassed: true,
        weather: {
          windKmh: 11,
          precipitationPct: 5,
          visibilityKm: 9,
          temperatureC: 27,
          source: "simulated",
          observedAt: now - 2 * 86_400_000,
        },
        airspace: { routeAuthorized: true, simulated: true, zoneIds: [] },
        containerTempC: 4,
        estimatedDurationMin: 9,
        stateHistory: [
          { state: "PLANNED", at: now - 2 * 86_400_000, note: "Demo mission planned." },
          { state: "COMPLETED", at: now - 2 * 86_400_000 + 3_600_000, note: "Demo mission completed (simulated)." },
        ],
        createdByUserId: demoUser._id,
        createdAt: now - 2 * 86_400_000,
        updatedAt: now - 2 * 86_400_000 + 3_600_000,
        dispatchedAt: now - 2 * 86_400_000 + 300_000,
        deliveredAt: now - 2 * 86_400_000 + 2_400_000,
        completedAt: now - 2 * 86_400_000 + 3_600_000,
        note: "Closed simulated mission retained for history. Never represented as a real flight.",
      });
      await ctx.db.insert("missionEvents", {
        missionId: demoMissionId,
        toState: "COMPLETED",
        at: now - 2 * 86_400_000 + 3_600_000,
        note: "Demo mission completed (simulated).",
        isSimulated: true,
      });
      await ctx.db.patch(transferId, { droneMissionId: demoMissionId });
    }

    await ctx.db.insert("auditLogs", {
      actorRole: "system",
      action: "demo.seeded",
      entityType: "demo",
      entityId: SEED_KEY,
      detail:
        "Demo network data loaded (organizations, inventory, requests, camps, transfer agreements, mock integrations, simulated fleet, mission history and demand history).",
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
