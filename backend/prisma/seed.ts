import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface CategorySeed {
  code: string;
  sortOrder: number;
  pt: string;
  fr: string;
}

const CATEGORIES: CategorySeed[] = [
  { code: "pdr", sortOrder: 10, pt: "PDR / Martelinho", fr: "Débosselage sans peinture (DSP)" },
  { code: "assembly_disassembly", sortOrder: 20, pt: "Montagem e Desmontagem", fr: "Démontage et Remontage" },
  { code: "bodywork", sortOrder: 30, pt: "Funilaria e Carroceria", fr: "Carrosserie et Tôlerie" },
  { code: "paint", sortOrder: 40, pt: "Pintura e Preparação", fr: "Peinture et Préparation" },
  { code: "mechanics", sortOrder: 50, pt: "Mecânica Geral", fr: "Mécanique Générale" },
  { code: "brakes_suspension", sortOrder: 60, pt: "Freios, Direção e Suspensão", fr: "Freinage, Direction et Suspension" },
  { code: "electrical_adas", sortOrder: 70, pt: "Elétrica, Eletrônica e ADAS", fr: "Électrique, Électronique et ADAS" },
  { code: "diagnostics", sortOrder: 80, pt: "Diagnóstico e Inspeção", fr: "Diagnostic et Contrôle" },
  { code: "glass_exterior", sortOrder: 90, pt: "Vidros e Externos", fr: "Vitrage et Extérieurs" },
  { code: "wheels_tires", sortOrder: 100, pt: "Rodas e Pneus", fr: "Roues et Pneus" },
  { code: "hvac", sortOrder: 110, pt: "Climatização / Ar-Condicionado", fr: "Climatisation" },
  { code: "detailing", sortOrder: 120, pt: "Estética e Detalhamento", fr: "Esthétique et Préparation" },
];

interface CatalogItemSeed {
  code: string;
  categoryCode: string;
  operationType: string;
  unitType: string;
  requiresVehicleRegion?: boolean;
  requiresQuantity?: boolean;
  defaultStageCode?: string;
  pt: string;
  fr: string;
  descriptionPt?: string;
  descriptionFr?: string;
}

const CATALOG_ITEMS: CatalogItemSeed[] = [
  // --- PDR / Martelinho ---
  {
    code: "pdr.hail_panel_repair",
    categoryCode: "pdr",
    operationType: "repair",
    unitType: "panel",
    requiresVehicleRegion: true,
    requiresQuantity: true,
    defaultStageCode: "pdr",
    pt: "Reparação PDR de painel por granizo",
    fr: "Débosselage sans peinture d'un panneau grêlé",
  },
  {
    code: "pdr.glue_pulling",
    categoryCode: "pdr",
    operationType: "repair",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "pdr",
    pt: "Reparação PDR por tração com cola",
    fr: "Débosselage sans peinture par collage",
  },
  {
    code: "pdr.dent_access_internal",
    categoryCode: "pdr",
    operationType: "repair",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "pdr",
    pt: "Acesso interno para reparação PDR",
    fr: "Accès intérieur pour débosselage sans peinture",
  },
  {
    code: "pdr.dent_access_limited",
    categoryCode: "pdr",
    operationType: "repair",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "pdr",
    pt: "Reparação PDR com acesso limitado",
    fr: "Débosselage sans peinture à accès limité",
  },
  {
    code: "pdr.localized_repair",
    categoryCode: "pdr",
    operationType: "repair",
    unitType: "damage",
    requiresVehicleRegion: true,
    defaultStageCode: "pdr",
    pt: "Reparação localizada PDR",
    fr: "Réparation localisée PDR",
  },
  {
    code: "pdr.full_repair",
    categoryCode: "pdr",
    operationType: "repair",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "pdr",
    pt: "Reparação PDR completa",
    fr: "Réparation PDR complète",
  },
  {
    code: "pdr.finishing",
    categoryCode: "pdr",
    operationType: "repair",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "pdr",
    pt: "Acabamento e ajuste fino PDR",
    fr: "Finition et ajustement fin PDR",
  },
  {
    code: "pdr.aluminum_panel_repair",
    categoryCode: "pdr",
    operationType: "repair",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "pdr",
    pt: "Reparação PDR em painel de alumínio",
    fr: "Réparation PDR panneau aluminium",
  },

  // --- Montagem e Desmontagem ---
  {
    code: "assembly.remove_headliner",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    defaultStageCode: "disassembly",
    pt: "Desmontagem do forro de teto",
    fr: "Dépose de la garniture de pavillon",
  },
  {
    code: "assembly.install_headliner",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    defaultStageCode: "assembly",
    pt: "Montagem do forro de teto",
    fr: "Repose de la garniture de pavillon",
  },
  {
    code: "assembly.remove_door_trim",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "disassembly",
    pt: "Desmontagem de acabamento/forração de porta",
    fr: "Dépose de garniture de porte",
  },
  {
    code: "assembly.install_door_trim",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "assembly",
    pt: "Montagem de acabamento/forração de porta",
    fr: "Repose de garniture de porte",
  },
  {
    code: "assembly.remove_hood",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    defaultStageCode: "disassembly",
    pt: "Desmontagem de capô",
    fr: "Démontage de capot",
  },
  {
    code: "assembly.install_hood",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    defaultStageCode: "assembly",
    pt: "Montagem e alinhamento de capô",
    fr: "Montage et ajustement de capot",
  },
  {
    code: "assembly.remove_tailgate",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    defaultStageCode: "disassembly",
    pt: "Desmontagem de tampa traseira / porta-malas",
    fr: "Démontage de hayon / coffre",
  },
  {
    code: "assembly.install_tailgate",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    defaultStageCode: "assembly",
    pt: "Montagem de tampa traseira / porta-malas",
    fr: "Montage de hayon / coffre",
  },
  {
    code: "assembly.remove_door",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "disassembly",
    pt: "Desmontagem de porta",
    fr: "Démontage de porte",
  },
  {
    code: "assembly.install_door",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "assembly",
    pt: "Montagem e alinhamento de porta",
    fr: "Montage et alignement de porte",
  },
  {
    code: "assembly.remove_bumper",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "disassembly",
    pt: "Desmontagem de para-choque",
    fr: "Démontage de pare-chocs",
  },
  {
    code: "assembly.install_bumper",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "assembly",
    pt: "Montagem de para-choque com sensores",
    fr: "Montage de pare-chocs avec capteurs",
  },
  {
    code: "assembly.remove_fender",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "disassembly",
    pt: "Desmontagem de para-lama",
    fr: "Démontage d'aile",
  },
  {
    code: "assembly.install_fender",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    requiresVehicleRegion: true,
    defaultStageCode: "assembly",
    pt: "Montagem de para-lama",
    fr: "Montage d'aile",
  },
  {
    code: "assembly.remove_seats",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    defaultStageCode: "disassembly",
    pt: "Desmontagem de bancos",
    fr: "Démontage de sièges",
  },
  {
    code: "assembly.install_seats",
    categoryCode: "assembly_disassembly",
    operationType: "remove_install",
    unitType: "service",
    defaultStageCode: "assembly",
    pt: "Montagem de bancos com conexão elétrica",
    fr: "Montage de sièges avec connectique",
  },

  // --- Funilaria e Carroceria ---
  {
    code: "bodywork.panel_straightening",
    categoryCode: "bodywork",
    operationType: "repair",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "bodywork",
    pt: "Endireitamento e recuperação de painel",
    fr: "Redressage et remise en forme de panneau",
  },
  {
    code: "bodywork.structural_measurement",
    categoryCode: "bodywork",
    operationType: "diagnose",
    unitType: "service",
    defaultStageCode: "bodywork",
    pt: "Medição de geometria estrutural / gabarito",
    fr: "Mesure de géométrie de caisse au marbre",
  },
  {
    code: "bodywork.panel_repair",
    categoryCode: "bodywork",
    operationType: "repair",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "bodywork",
    pt: "Reparação de painel de lataria",
    fr: "Réparation de panneau de carrosserie",
  },
  {
    code: "bodywork.door_repair",
    categoryCode: "bodywork",
    operationType: "repair",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "bodywork",
    pt: "Reparação de porta",
    fr: "Réparation de porte",
  },
  {
    code: "bodywork.hood_repair",
    categoryCode: "bodywork",
    operationType: "repair",
    unitType: "panel",
    defaultStageCode: "bodywork",
    pt: "Reparação de capô",
    fr: "Réparation de capot",
  },
  {
    code: "bodywork.bumper_repair",
    categoryCode: "bodywork",
    operationType: "repair",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "bodywork",
    pt: "Reparação de para-choque",
    fr: "Réparation de pare-chocs",
  },
  {
    code: "bodywork.panel_replacement",
    categoryCode: "bodywork",
    operationType: "replace",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "bodywork",
    pt: "Substituição de painel de carroceria",
    fr: "Remplacement de panneau de carrosserie",
  },

  // --- Pintura e Preparação ---
  {
    code: "paint.color_matching",
    categoryCode: "paint",
    operationType: "paint",
    unitType: "service",
    defaultStageCode: "paint_prep",
    pt: "Ajuste de cor e colorimetria",
    fr: "Recherche de teinte et colorimétrie",
  },
  {
    code: "paint.blending",
    categoryCode: "paint",
    operationType: "paint",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "paint",
    pt: "Transição de pintura entre painéis (difuminado)",
    fr: "Raccord de peinture entre éléments (fondu)",
  },
  {
    code: "paint.undercoat_application",
    categoryCode: "paint",
    operationType: "paint",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "paint_prep",
    pt: "Aplicação de fundo preparador e primer",
    fr: "Application d'apprêt et préparation",
  },
  {
    code: "paint.clearcoat_application",
    categoryCode: "paint",
    operationType: "paint",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "paint",
    pt: "Aplicação de verniz",
    fr: "Application de vernis",
  },
  {
    code: "paint.post_paint_polish",
    categoryCode: "paint",
    operationType: "inspect",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "inspection",
    pt: "Polimento e lustro pós-pintura",
    fr: "Polissage et lustrage après peinture",
  },
  {
    code: "paint.partial_paint",
    categoryCode: "paint",
    operationType: "paint",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "paint",
    pt: "Pintura parcial / retoque",
    fr: "Peinture partielle / retouche",
  },
  {
    code: "paint.full_paint",
    categoryCode: "paint",
    operationType: "paint",
    unitType: "panel",
    requiresVehicleRegion: true,
    defaultStageCode: "paint",
    pt: "Pintura completa de peça",
    fr: "Peinture complète de panneau",
  },

  // --- Mecânica Geral ---
  {
    code: "mechanics.engine_oil_change",
    categoryCode: "mechanics",
    operationType: "maintain",
    unitType: "service",
    defaultStageCode: "mechanics",
    pt: "Troca de óleo do motor",
    fr: "Vidange d'huile moteur",
  },
  {
    code: "mechanics.filter_replacement",
    categoryCode: "mechanics",
    operationType: "replace",
    unitType: "service",
    defaultStageCode: "mechanics",
    pt: "Substituição de filtros (óleo, ar, combustível, cabine)",
    fr: "Remplacement des filtres (huile, air, carburant, habitacle)",
  },
  {
    code: "mechanics.coolant_pump_replace",
    categoryCode: "mechanics",
    operationType: "replace",
    unitType: "service",
    defaultStageCode: "mechanics",
    pt: "Substituição da bomba d'água",
    fr: "Remplacement de la pompe à eau",
  },
  {
    code: "mechanics.clutch_replace",
    categoryCode: "mechanics",
    operationType: "replace",
    unitType: "service",
    defaultStageCode: "mechanics",
    pt: "Substituição do kit de embreagem",
    fr: "Remplacement du kit d'embrayage",
  },
  {
    code: "mechanics.starter_replace",
    categoryCode: "mechanics",
    operationType: "replace",
    unitType: "service",
    defaultStageCode: "mechanics",
    pt: "Substituição do motor de arranque",
    fr: "Remplacement du démarreur",
  },

  // --- Freios, Direção e Suspensão ---
  {
    code: "brakes.front_pad_replace",
    categoryCode: "brakes_suspension",
    operationType: "replace",
    unitType: "axle",
    defaultStageCode: "mechanics",
    pt: "Substituição de pastilhas de freio dianteiras",
    fr: "Remplacement des plaquettes de frein avant",
  },
  {
    code: "brakes.brake_fluid_change",
    categoryCode: "brakes_suspension",
    operationType: "maintain",
    unitType: "service",
    defaultStageCode: "mechanics",
    pt: "Troca e purga de fluido de freio",
    fr: "Purge et remplacement du liquide de frein",
  },
  {
    code: "suspension.damper_replace",
    categoryCode: "brakes_suspension",
    operationType: "replace",
    unitType: "part",
    requiresVehicleRegion: true,
    defaultStageCode: "mechanics",
    pt: "Substituição de amortecedor",
    fr: "Remplacement d'amortisseur",
  },
  {
    code: "suspension.alignment",
    categoryCode: "brakes_suspension",
    operationType: "calibrate",
    unitType: "service",
    defaultStageCode: "mechanics",
    pt: "Alinhamento e geometria de direção",
    fr: "Géométrie et alignement des trains",
  },

  // --- Elétrica, Eletrônica e ADAS ---
  {
    code: "electrical.battery_test",
    categoryCode: "electrical_adas",
    operationType: "diagnose",
    unitType: "service",
    defaultStageCode: "mechanics",
    pt: "Teste de carga e saúde da bateria",
    fr: "Contrôle et test de batterie",
  },
  {
    code: "adas.camera_calibration",
    categoryCode: "electrical_adas",
    operationType: "calibrate",
    unitType: "service",
    defaultStageCode: "diagnosis",
    pt: "Calibração de câmera frontal ADAS",
    fr: "Calibrage de caméra avant ADAS",
  },
  {
    code: "adas.radar_calibration",
    categoryCode: "electrical_adas",
    operationType: "calibrate",
    unitType: "service",
    defaultStageCode: "diagnosis",
    pt: "Calibração de radar de para-choque ADAS",
    fr: "Calibrage de radar de pare-chocs ADAS",
  },

  // --- Diagnóstico e Inspeção ---
  {
    code: "diagnostics.pre_repair_scan",
    categoryCode: "diagnostics",
    operationType: "diagnose",
    unitType: "service",
    defaultStageCode: "diagnosis",
    pt: "Diagnóstico eletrônico pré-reparação (Scanner)",
    fr: "Diagnostic électronique avant réparation (Scan)",
  },
  {
    code: "diagnostics.post_repair_scan",
    categoryCode: "diagnostics",
    operationType: "diagnose",
    unitType: "service",
    defaultStageCode: "inspection",
    pt: "Diagnóstico eletrônico pós-reparação e reset de falhas",
    fr: "Diagnostic électronique après réparation et effacement défauts",
  },

  // --- Vidros e Externos ---
  {
    code: "glass.windshield_replace",
    categoryCode: "glass_exterior",
    operationType: "replace",
    unitType: "part",
    defaultStageCode: "assembly",
    pt: "Substituição e colagem de para-brisa",
    fr: "Remplacement et collage de pare-brise",
  },

  // --- Rodas e Pneus ---
  {
    code: "wheels.tire_balance",
    categoryCode: "wheels_tires",
    operationType: "calibrate",
    unitType: "wheel",
    requiresQuantity: true,
    defaultStageCode: "mechanics",
    pt: "Balanceamento de roda",
    fr: "Équilibrage de roue",
  },

  // --- Climatização ---
  {
    code: "hvac.leak_diagnosis",
    categoryCode: "hvac",
    operationType: "diagnose",
    unitType: "service",
    defaultStageCode: "mechanics",
    pt: "Diagnóstico de vazamento e recarga do ar-condicionado",
    fr: "Recherche de fuite et recharge de climatisation",
  },

  // --- Estética e Detalhamento ---
  {
    code: "detailing.delivery_clean",
    categoryCode: "detailing",
    operationType: "clean",
    unitType: "service",
    defaultStageCode: "inspection",
    pt: "Lavagem e higienização técnica de entrega",
    fr: "Nettoyage et préparation esthétique avant restitution",
  },
];

async function main() {
  console.log("Seeding Service Categories...");
  const categoryMap = new Map<string, string>();

  for (const cat of CATEGORIES) {
    const category = await prisma.serviceCategory.upsert({
      where: { code: cat.code },
      update: {
        sortOrder: cat.sortOrder,
        active: true,
      },
      create: {
        code: cat.code,
        sortOrder: cat.sortOrder,
        active: true,
      },
    });

    categoryMap.set(cat.code, category.id);

    // Translations
    await prisma.serviceCategoryTranslation.upsert({
      where: {
        categoryId_locale: { categoryId: category.id, locale: "pt-BR" },
      },
      update: { name: cat.pt },
      create: { categoryId: category.id, locale: "pt-BR", name: cat.pt },
    });

    await prisma.serviceCategoryTranslation.upsert({
      where: {
        categoryId_locale: { categoryId: category.id, locale: "fr-FR" },
      },
      update: { name: cat.fr },
      create: { categoryId: category.id, locale: "fr-FR", name: cat.fr },
    });
  }

  console.log("Seeding Global Service Catalog Items...");
  for (const item of CATALOG_ITEMS) {
    const categoryId = categoryMap.get(item.categoryCode);
    if (!categoryId) {
      console.warn(`Category not found: ${item.categoryCode}`);
      continue;
    }

    const existingItem = await prisma.serviceCatalogItem.findFirst({
      where: {
        code: item.code,
        workspaceId: null,
      },
    });

    let itemId = existingItem?.id;

    if (!existingItem) {
      const created = await prisma.serviceCatalogItem.create({
        data: {
          code: item.code,
          workspaceId: null,
          categoryId,
          operationType: item.operationType,
          unitType: item.unitType,
          requiresVehicleRegion: item.requiresVehicleRegion ?? false,
          requiresQuantity: item.requiresQuantity ?? false,
          defaultStageCode: item.defaultStageCode,
          isActive: true,
        },
      });
      itemId = created.id;
    } else {
      await prisma.serviceCatalogItem.update({
        where: { id: existingItem.id },
        data: {
          categoryId,
          operationType: item.operationType,
          unitType: item.unitType,
          requiresVehicleRegion: item.requiresVehicleRegion ?? false,
          requiresQuantity: item.requiresQuantity ?? false,
          defaultStageCode: item.defaultStageCode,
          isActive: true,
        },
      });
    }

    if (itemId) {
      // Translations
      await prisma.serviceCatalogTranslation.upsert({
        where: {
          itemId_locale: { itemId, locale: "pt-BR" },
        },
        update: { name: item.pt, description: item.descriptionPt },
        create: { itemId, locale: "pt-BR", name: item.pt, description: item.descriptionPt },
      });

      await prisma.serviceCatalogTranslation.upsert({
        where: {
          itemId_locale: { itemId, locale: "fr-FR" },
        },
        update: { name: item.fr, description: item.descriptionFr },
        create: { itemId, locale: "fr-FR", name: item.fr, description: item.descriptionFr },
      });
    }
  }

  console.log("Catalog seeding completed successfully.");
}

main()
  .catch((e) => {
    console.error("Error during seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
