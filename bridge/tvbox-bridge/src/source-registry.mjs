const LOGIN_REQUIRED_KEYS = new Set([
  'MDrive', '玩偶', 'seed', 'ZPan', '抠搜', 'UC', 'YpanSo', 'BpanSo'
]);

const FAST_SEARCH_KEYS = new Set([
  '玩偶', 'seed', '光影', '原创', '厂长', '立播', '瓜子', '比特', '荐片', '糯米',
  '文采', '奶酪', '热播', '视界', '播客', '剧圈', '奥特', '新6V', '咕咕', 'Dm84',
  'Anime1', '抠搜', 'UC', 'YpanSo', 'BpanSo'
]);

const SOURCE_KEYS = [
  '玩偶', 'seed', '光影', '原创', '厂长', '立播', '瓜子', '比特', '荐片', '糯米',
  '文采', '奶酪', '热播', '视界', '播客', '剧圈', '奥特', '新6V', '咕咕', 'Dm84',
  'Anime1', '抠搜', 'UC', 'YpanSo', 'BpanSo',
  'MDrive', 'ZPan', 'AList', '豆瓣', '短剧', '虎牙', '斗鱼', 'B站', '直播', '音乐',
  '体育', '少儿', '纪录', '4K', '磁力', '网盘聚合', '夸克', '阿里', '115',
  '百度', '天翼', '迅雷', '移动云盘'
];

function sourceStatusFor(key) {
  if (LOGIN_REQUIRED_KEYS.has(key)) return STATUS.LOGIN_REQUIRED;
  if (hasAdapter(key)) return STATUS.READY;
  return STATUS.UNSUPPORTED;
}

export function listSources() {
  return SOURCE_KEYS.map((key) => {
    const adapter = getAdapter(key);
    return {
      key,
      type: 3,
      fastSearch: FAST_SEARCH_KEYS.has(key),
      status: sourceStatusFor(key),
      adapter: !!adapter,
      reason: LOGIN_REQUIRED_KEYS.has(key)
      ? '需要本机网盘凭据或首帧验证，bridge 不读取也不转移凭据'
        : adapter
          ? '已启用 HTTP adapter；播放阶段若返回网盘地址会降级为 login_required'
          : '电视源依赖 CatVod spider 运行时，当前 bridge 未启用可执行适配器'
    };
  });
}

export function getSource(key) {
  return listSources().find((source) => source.key === key) || null;
}

export function summarizeSources() {
  const sources = listSources();
  const byStatus = sources.reduce((acc, source) => {
    acc[source.status] = (acc[source.status] || 0) + 1;
    return acc;
  }, {});
  return {
    total: sources.length,
    byStatus,
    fastSearch: sources.filter((source) => source.fastSearch).length
  };
}
import { getAdapter, hasAdapter } from './adapter-registry.mjs';
import { STATUS } from './status.mjs';
