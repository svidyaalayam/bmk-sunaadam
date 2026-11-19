import test from "node:test";
import assert from "node:assert/strict";

function isMelakartaRagam(ragam) {
  if (typeof ragam.isMelakarta === "boolean") return ragam.isMelakarta;
  if (ragam.melakartaName && ragam.name) {
    return ragam.name.trim().toLowerCase() === ragam.melakartaName.trim().toLowerCase();
  }
  return Boolean(ragam.melakartaNumber);
}

function resolveAllowRagamChange(session, parentSession = null, exercise = null) {
  return Boolean(
    session?.allowRagamChange ??
    session?.allow_ragam_change ??
    parentSession?.allowRagamChange ??
    parentSession?.allow_ragam_change ??
    exercise?.allowRagamChange ??
    false
  );
}

function formatRagamDisplayName(selectedRagam, currentExercise = null) {
  if (selectedRagam) {
    return `${selectedRagam.melakartaNumber ? `${selectedRagam.melakartaNumber}. ` : ""}${selectedRagam.name}`;
  }
  if (currentExercise?.ragamName) {
    return `${currentExercise.melakartaNumber ? `${currentExercise.melakartaNumber}. ` : ""}${currentExercise.ragamName}`;
  }
  return "—";
}

test("isMelakartaRagam correctly filters Melakarta vs Janya ragams", () => {
  const ragams = [
    {
      id: 1,
      name: "Mayamalavagowla",
      melakartaId: 15,
      melakartaName: "Mayamalavagowla",
      melakartaNumber: 15,
      isMelakarta: true,
    },
    {
      id: 2,
      name: "Dheerasankarabharanam",
      melakartaId: 29,
      melakartaName: "Dheerasankarabharanam",
      melakartaNumber: 29,
      isMelakarta: true,
    },
    {
      id: 3,
      name: "Malahari", // Janya of Mayamalavagowla
      melakartaId: 15,
      melakartaName: "Mayamalavagowla",
      melakartaNumber: 15,
      isMelakarta: false,
    },
    {
      id: 4,
      name: "Mohanam", // Janya of Harikambhoji
      melakartaId: 28,
      melakartaName: "Harikambhoji",
      melakartaNumber: 28,
      isMelakarta: false,
    },
    {
      id: 5,
      name: "Kalyani",
      melakartaId: 65,
      melakartaName: "Kalyani",
      melakartaNumber: 65,
    },
  ];

  const melakarthas = ragams.filter(isMelakartaRagam);
  assert.equal(melakarthas.length, 3);
  assert.deepEqual(
    melakarthas.map((r) => r.name),
    ["Mayamalavagowla", "Dheerasankarabharanam", "Kalyani"]
  );
});

test("resolveAllowRagamChange determines editability accurately", () => {
  // Session with allowRagamChange: true
  const saraliSession = { id: "sarali", name: "Sarali swarams", allowRagamChange: true };
  assert.equal(resolveAllowRagamChange(saraliSession), true);

  // Session with allowRagamChange: false
  const geethamsSession = { id: "geethams", name: "Geethams", allowRagamChange: false };
  assert.equal(resolveAllowRagamChange(geethamsSession), false);

  // Child session inherits from parent if parent is true
  const parentSession = { id: "carnatic", name: "Carnatic", allowRagamChange: true };
  const childSessionNoFlag = { id: "varisai", name: "Janta varisai", parentId: "carnatic" };
  assert.equal(resolveAllowRagamChange(childSessionNoFlag, parentSession), true);

  // Session default is false
  assert.equal(resolveAllowRagamChange({ id: "songs", name: "Songs" }), false);
});

test("formatRagamDisplayName displays numbers for Melakarta and plain names for Janya", () => {
  const mela = { name: "Mayamalavagowla", melakartaNumber: 15 };
  assert.equal(formatRagamDisplayName(mela), "15. Mayamalavagowla");

  const janya = { name: "Malahari", melakartaNumber: null };
  assert.equal(formatRagamDisplayName(janya), "Malahari");

  const exerciseFallback = { ragamName: "Hamsadhwani", melakartaNumber: null };
  assert.equal(formatRagamDisplayName(null, exerciseFallback), "Hamsadhwani");
});
