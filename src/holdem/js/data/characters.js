// キャラクター定義読み込み（HTTP配信前提）/ 失敗時はフォールバック

const FALLBACK_CHARACTERS = [
  {
    key: 'souma',
    name: '朝霧 湊真',
    gender: 'male',
    avatar: '../../assets/avatars/player-1.png',
    pose: '../../assets/avatars/souma-full.png',
    ability: { key: 'foresight', name: '未来視', desc: '次に公開されるボードカードを最大3枚まで透視（3回まで）', maxUses: 3 },
    lines: {
      check: ['様子を見る。','今は動かない。'],
      call: ['受ける。','確かめよう。'],
      raise: ['レイズ。','ここは押すべきだ。'],
      allin: ['すべて賭ける。','読みは揺らがない。'],
      fold: ['ここは引く。','分が悪い。'],
      win: ['想定通り。','未来はこの形だった。'],
      lose: ['次は修正する。','僅差だ。'],
      ability: ['視える——次の一手。','未来視、起動。']
    }
  },
  {
    key: 'yuri',
    name: '桜庭 柚凛',
    gender: 'female',
    avatar: '../../assets/avatars/player-0.png',
    pose: '../../assets/avatars/yuri-full.png',
    ability: { key: 'clairvoyance', name: '透視', desc: '各ラウンド1回まで／全員の手札から各1〜2枚を可視化（3回まで）', maxUses: 3 },
    lines: {
      check: ['ふん、まだ見せないでしょ。','様子見ってわけ。'],
      call: ['受けてあげる。','そこ、乗るわ。'],
      raise: ['もっと上げるわよ。','ビビってんの？ レイズ。'],
      allin: ['全部ぶつける！','ここが勝負所よ！'],
      fold: ['今回は退いてあげる。','ツイてないわね。'],
      win: ['ほら、暴いて勝つ。','読めてたって言ったでしょ。'],
      lose: ['次は隠せないからね。','ちょっとズレたわね。'],
      ability: ['見せてもらうわよ——全部ね。','透視、発動。隠し事は無し。']
    }
  },
  {
    key: 'yusei',
    name: '霧坂 悠聖',
    gender: 'male',
    avatar: '../../assets/avatars/player-2.png',
    pose: '../../assets/avatars/yusei-full.png',
    ability: { key: 'teleport', name: '瞬間移動', desc: '自分の手札1枚をすり替える（3回まで）', maxUses: 3 },
    lines: {
      check: ['……今は静かに。','焦らない。'],
      call: ['行く。','受けるだけ。'],
      raise: ['上げる。','ここで圧を。'],
      allin: ['全額。','ここで決める。'],
      fold: ['撤退。','引く。'],
      win: ['……勝った。','運じゃない。'],
      lose: ['次だ。','動きが足りなかった。'],
      ability: ['位置、変える。','一枚だけ——置き換える。']
    }
  },
  {
    key: 'satsuki',
    name: '水瀬 紗月',
    gender: 'female',
    avatar: '../../assets/avatars/player-3.png',
    pose: '../../assets/avatars/satsuki-full.png',
    ability: { key: 'blessing', name: '幸運の加護', desc: '発動後、次のターンで役が揃いやすくなる（3回まで）', maxUses: 3 },
    lines: {
      check: ['慌てずに……ね。','様子を見ましょう。'],
      call: ['受けます。','うん、行けると思う。'],
      raise: ['少しだけ上げますね。','ここは押してみます。'],
      allin: ['えいっ……全部！','運も味方してる、はず。'],
      fold: ['ここはガマン、ですね。','無理はしないの。'],
      win: ['よかった……！','うん、繋がった。'],
      lose: ['次こそは……！','まだ、諦めないよ。'],
      ability: ['どうか、いい巡り合わせを——','加護を、少しだけ。']
    }
  },
];

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
          ability: {
            key: data.ability.key || '',
            name: data.ability.name || '',
            desc: data.ability.desc || data.ability.effect_text || '',
            maxUses: data.ability.maxUses || 3,
          },
        });
      } catch (_) { /* 個別失敗は無視 */ }
    }
    if (!loaded.length) return [...FALLBACK_CHARACTERS];
    const order = ['souma', 'yuri', 'yusei', 'satsuki'];
    loaded.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const preferred = loaded.filter(c => order.includes(c.key));
    const others = loaded.filter(c => !order.includes(c.key));
    return [...preferred, ...others];
  } catch (e) {
    console.warn('キャラJSONの読み込みに失敗:', e);
    return [...FALLBACK_CHARACTERS];
  }
}

