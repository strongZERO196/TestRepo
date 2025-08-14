// キャラクター定義読み込み（HTTP配信前提）/ 失敗時はフォールバック


export async function loadCharactersFromJson() {
  try {
    const manifestUrl = '../../assets/avatars/manifest.json';
    const baseUrl = '../../assets/avatars/';
    const res = await fetch(manifestUrl);
    if (!res || !res.ok) throw new Error('manifest fetch failed');
    const files = await res.json();
    const loaded = [];
    for (const f of files) {
      try {
        const r = await fetch(baseUrl + f);
        if (!r || !r.ok) throw new Error('file fetch failed: ' + f);
        const data = await r.json();
        if (!data || !data.key || !data.ability) continue;
        loaded.push({
          key: data.key,
          name: data.name || data.id || data.key,
          gender: data.gender || 'unknown',
          avatar: data.avatar || '',
          pose: data.pose || data.avatar || '',
          lines: data.lines || {},
          rules: data.rules || null,
          story: data.story || null,
          background: data.background || '',
          ability: {
            key: data.ability.key || '',
            name: data.ability.name || '',
            desc: data.ability.desc || data.ability.effect_text || '',
            maxUses: data.ability.maxUses || 3,
          },
        });
      } catch (_) { /* 個別失敗は無視 */ }
    }
    if (!loaded.length) return [];
    const order = ['souma', 'yuri', 'yusei', 'satsuki'];
    loaded.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const preferred = loaded.filter(c => order.includes(c.key));
    const others = loaded.filter(c => !order.includes(c.key));
    return [...preferred, ...others];
  } catch (e) {
    console.warn('キャラJSONの読み込みに失敗:', e);
    return [];
  }
}
