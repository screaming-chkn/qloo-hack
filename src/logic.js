// Our logic layer: score + rank Qloo entities, every claim carries proof.
export function rank(entities = [], { seed } = {}) {
  return entities
    .map((e) => {
      const affinity = Number(e?.query?.affinity ?? 0);
      const popularity = Number(e?.popularity ?? 0);
      const score = +(0.7 * affinity + 0.3 * popularity).toFixed(4);
      const why = [
        { claim: `affinity ${affinity}`, proof: { entity_id: e.entity_id, signal: "query.affinity", value: affinity, seed } },
        { claim: `popularity ${popularity}`, proof: { entity_id: e.entity_id, signal: "popularity", value: popularity } },
        ...(e.tags || []).slice(0, 2).map((t) => ({ claim: `tagged ${t.name}`, proof: { entity_id: e.entity_id, signal: "tags", value: t.id } })),
      ];
      return { entity_id: e.entity_id, name: e.name, score, why };
    })
    .sort((a, b) => b.score - a.score);
}
