export const LOCAL_IMPRESSIONS = {
  loose: [
    'カラッ。少し遊びがありそう。',
    'カタ、と余韻。すき間がある感じ。',
    '指先でカラリ。軽く動きそうな感触。',
    '乾いた響き。押し返す力は薄そう。',
    'カララン。音が奥まで通る感じ。',
    '軽いコトッ。少しゆとりがありそう。',
    'カタカタ。小さな遊びを感じる。',
    '響きがふわり。抵抗は少なそう。',
    'コロン。指先への返りが淡い感じ。',
    'カラッと鳴る。力みがないみたい。',
    '軽い余韻。触れた所に遊びがありそう。',
    'カタッ。つっぱりは弱い気がする。',
  ],
  light: [
    'コツ。少し抵抗がありそう。',
    'コトッ。指にわずかに返る感じ。',
    '響きの奥に、小さな重さがありそう。',
    'コツン。少し引っかかるような感じ。',
    '余韻はある。少し力を受けていそう。',
    '軽いコツ。うっすら張っている感じ。',
    '指先に小さな返り。少し硬いかも。',
    'コトン。かすかなつっぱりがありそう。',
    '響きが短く返る。少し抵抗する感じ。',
    'コツ、と鳴る。軽く押し返すみたい。',
    '余韻が少し残る。手応えもある感じ。',
    '軽い音の底に、重さがある気がする。',
  ],
  firm: [
    'コツッ。つっぱっていそう。',
    '短いコツッ。指先を押し返す感じ。',
    '響きが詰まる。力を受けていそう。',
    'コッ。奥に重さがある感じ。',
    '乾いた音。ぴんと張っているみたい。',
    'コツン、と硬い返り。抵抗がありそう。',
    '余韻がすっと止まる。つっぱる感じ。',
    '指先にコツッ。張りがある気がする。',
    '短く鳴る。重さを受けているみたい。',
    'コツッと返る。押し返す力がありそう。',
    '音が広がらない。少し詰まった感じ。',
    '硬い打音。しっかり力んでいそう。',
  ],
  tight: [
    'ゴツッ。かなり力を受けていそう。',
    '鈍いゴッ。奥まで詰まった感じ。',
    '重い返り。強くつっぱっていそう。',
    'ゴツン。指が押し戻されるみたい。',
    '低く短い音。重さが集まった感じ。',
    'ゴッ、と止まる。かなり張っていそう。',
    '余韻はわずか。強い抵抗を感じる。',
    '重たいコッ。動きがとても渋そう。',
    '指先にずしり。力を抱えている感じ。',
    '鈍く詰まる音。踏ん張っているみたい。',
    'ゴツッと跳ね返る。張りが強そう。',
    '低い胴鳴り。深く力んでいる感じ。',
  ],
};

export function impressionBand({ grip }) {
  return grip > 0.72 ? 'tight' : grip > 0.4 ? 'firm' : grip > 0.18 ? 'light' : 'loose';
}

export function soundImpression(profile) {
  return LOCAL_IMPRESSIONS[impressionBand(profile)][0];
}

export class StructureCaptions {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.bags = new Map();
    this.last = new Map();
    this.sequence = 0;
    this.status = 'local';
  }
  cancel() {
    this.sequence++;
  }
  describe(profile) {
    const band = impressionBand(profile);
    let bag = this.bags.get(band);
    if (!bag?.length) {
      bag = [...LOCAL_IMPRESSIONS[band]];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag.at(-1) === this.last.get(band)) [bag[0], bag[bag.length - 1]] = [bag.at(-1), bag[0]];
      this.bags.set(band, bag);
    }
    const text = bag.pop();
    this.last.set(band, text);
    return { text, band, source: 'local' };
  }
}
