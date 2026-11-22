import { parseTcpEvents, type TcpState, type WindowMode } from './lab408SimOsNet.ts';
import type { PipelineDefinition, PipelineFrame, PipelineResult, PipelineStage } from './lab408PipelineTypes.ts';

function bounded(value: number | undefined, fallback: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value !== undefined && Number.isFinite(value) ? value : fallback)));
}

function errorResult(title: string, error: string): PipelineResult {
  return { data: { error }, frames: [{ title, summary: error }] };
}

type TcpEvent = { event: string; rwnd: number };
type TcpPoint = TcpEvent & { cwnd: number; ssthresh: number; state: TcpState; swnd: number; reason: string };

const tcpStates: Record<TcpState, string> = {
  slow_start: '慢开始',
  congestion_avoidance: '拥塞避免',
  fast_recovery: '快恢复',
};
const tcpEvents: Record<string, string> = {
  start: '初始状态',
  ack: '正常 ACK',
  '3ack': '3 个重复 ACK',
  timeout: '超时',
};

const tcp: PipelineDefinition = { stages: [
  {
    id: 'source', title: 'TCP RTT 事件源', diagram: 'source',
    text: 'ack, ack, ack, ack, 3ack, ack@3, timeout',
    textLabel: '每 RTT 一个事件，可用 ack@3 通告 rwnd=3',
    controls: [
      { key: 'ssthresh', label: '初始慢开始阈值（MSS）', value: 8, min: 2, max: 64, step: 1 },
      { key: 'rwnd', label: '初始接收窗口（MSS）', value: 6, min: 0, max: 64, step: 1 },
    ],
    actions: [
      { label: '追加正常 ACK', append: ', ack' },
      { label: '追加 3 个重复 ACK', append: ', 3ack' },
      { label: '追加超时', append: ', timeout' },
    ],
    run: ({ text, params }) => {
      const ssthresh = bounded(params.ssthresh, 8, 2, 64);
      const initialRwnd = bounded(params.rwnd, 6, 0, 64);
      let rwnd = initialRwnd;
      const events: TcpEvent[] = [];
      const invalid: string[] = [];
      const tokens = text.slice(0, 4096).replace(/(\d+)\s+ack\b/gi, '$1ack').split(/[\s,，、;；]+/).filter(Boolean);
      for (const token of tokens.slice(0, 120)) {
        const match = /^(ack|正常ack|确认|3ack|3a|dupack|重复ack|三次重复确认|快重传|timeout|rto|超时)(?:@(\d{1,5}))?$/i.exec(token);
        const event = match && parseTcpEvents(match[1] ?? '')[0];
        if (!event || (match?.[2] && event === 'timeout')) {
          invalid.push(token);
          continue;
        }
        if (match?.[2]) rwnd = Number(match[2]);
        events.push({ event, rwnd });
      }
      const warnings = [
        invalid.length ? `已忽略无效事件 ${invalid.join('、')}` : '',
        tokens.length > 120 || text.length > 4096 ? '事件输入最多读取 120 项、4096 字符' : '',
      ].filter(Boolean);
      return {
        data: { ssthresh, initialRwnd, events },
        frames: [{
          title: 'RTT 输入事件',
          summary: [`共 ${events.length} 个事件，接收窗口会沿用最近一次通告`, ...warnings].join('。'),
          columns: ['RTT', '事件', 'rwnd（MSS）'],
          rows: [[0, '初始状态', initialRwnd], ...events.map((entry, index) => [index + 1, tcpEvents[entry.event] ?? entry.event, entry.rwnd])],
        }],
      };
    },
  },
  {
    id: 'machine', title: 'TCP Reno 状态机', diagram: 'graph', inputs: ['source'],
    run: ({ upstream: [source] }) => {
      if (!Array.isArray(source?.events)) return errorResult('等待上游', '连接 TCP RTT 事件源后生成状态轨迹');
      let rwnd = Number(source.initialRwnd);
      let ssthresh = Number(source.ssthresh);
      let cwnd = 1;
      let state: TcpState = 'slow_start';
      const points: TcpPoint[] = [];
      const record = (event: string, reason: string) => {
        points.push({ event, reason, cwnd, ssthresh, state, rwnd, swnd: Math.min(cwnd, rwnd) });
      };
      record('start', '初始拥塞窗口为 1 MSS');
      for (const entry of source.events as TcpEvent[]) {
        rwnd = entry.rwnd;
        if (entry.event === 'timeout') {
          ssthresh = Math.max(2, Math.floor(cwnd / 2));
          cwnd = 1;
          state = 'slow_start';
          record(entry.event, '超时令阈值减半（至少 2 MSS），cwnd 重置为 1 MSS');
        } else if (entry.event === '3ack') {
          ssthresh = Math.max(2, Math.floor(cwnd / 2));
          cwnd = ssthresh + 3;
          state = 'fast_recovery';
          record(entry.event, '快重传丢失报文段，阈值减半（至少 2 MSS），cwnd 暂设为 ssthresh + 3');
        } else if (state === 'fast_recovery') {
          cwnd = ssthresh;
          state = 'congestion_avoidance';
          record(entry.event, '新 ACK 确认重传，cwnd 收缩至 ssthresh');
        } else if (state === 'slow_start') {
          cwnd = Math.min(cwnd * 2, ssthresh);
          if (cwnd >= ssthresh) state = 'congestion_avoidance';
          record(entry.event, '每 RTT 将 cwnd 翻倍，达到阈值后进入拥塞避免');
        } else {
          cwnd += 1;
          record(entry.event, '拥塞避免，每 RTT 增加 1 MSS');
        }
      }
      const transitions = [
        { from: 'slow_start', to: 'congestion_avoidance', label: '达到阈值' },
        { from: 'congestion_avoidance', to: 'fast_recovery', label: '3 个重复 ACK' },
        { from: 'slow_start', to: 'fast_recovery', label: '3 个重复 ACK' },
        { from: 'fast_recovery', to: 'congestion_avoidance', label: '正常 ACK' },
        { from: 'fast_recovery', to: 'slow_start', label: '超时' },
        { from: 'congestion_avoidance', to: 'slow_start', label: '超时' },
      ];
      return {
        data: { points },
        frames: points.map((point, rtt) => ({
          title: `RTT ${rtt} · ${tcpEvents[point.event]}`,
          summary: point.reason,
          columns: ['阶段', 'cwnd', 'ssthresh', 'rwnd', 'swnd'],
          rows: [[tcpStates[point.state], point.cwnd, point.ssthresh, point.rwnd, point.swnd]],
          graph: {
            nodes: [
              { id: 'slow_start', label: tcpStates.slow_start, x: 20, y: 75, active: point.state === 'slow_start' },
              { id: 'congestion_avoidance', label: tcpStates.congestion_avoidance, x: 80, y: 75, active: point.state === 'congestion_avoidance' },
              { id: 'fast_recovery', label: tcpStates.fast_recovery, x: 50, y: 25, active: point.state === 'fast_recovery' },
            ],
            edges: transitions.map(({ from, to, label }) => {
              const active = from === points[rtt - 1]?.state && to === point.state;
              return { from, to, label: active ? label : undefined, active };
            }).sort((a, b) => Number(a.active) - Number(b.active)),
          },
        })),
      };
    },
  },
  {
    id: 'curves', title: 'RTT 窗口曲线', diagram: 'chart', inputs: ['machine'],
    run: ({ upstream: [machine] }) => {
      if (!Array.isArray(machine?.points)) return errorResult('等待上游', '连接 TCP Reno 状态机后绘制曲线');
      const points = machine.points as TcpPoint[];
      return {
        data: { points },
        frames: [{
          title: '窗口随 RTT 变化',
          summary: '横轴从 RTT 0 开始，纵轴以 MSS 为单位。发送窗口 swnd = min(cwnd, rwnd)，本实验用 cwnd 估算丢包时的在途数据量',
          series: (['cwnd', 'ssthresh', 'rwnd', 'swnd'] as const).map(label => ({ label, values: points.map(point => point[label]) })),
          columns: ['RTT', 'cwnd', 'ssthresh', 'rwnd', 'swnd'],
          rows: points.map((point, rtt) => [rtt, point.cwnd, point.ssthresh, point.rwnd, point.swnd]),
          highlightRows: points.flatMap((point, rtt) => point.event === '3ack' || point.event === 'timeout' ? [rtt] : []),
        }],
      };
    },
  },
  {
    id: 'diagnostics', title: '拥塞与流量控制诊断', diagram: 'summary', inputs: ['curves'],
    run: ({ upstream: [curves] }) => {
      if (!Array.isArray(curves?.points)) return errorResult('等待上游', '连接 RTT 窗口曲线后分析瓶颈');
      const points = curves.points as TcpPoint[];
      const fastRetransmits = points.filter(point => point.event === '3ack').length;
      const timeouts = points.filter(point => point.event === 'timeout').length;
      const flowLimited = points.filter(point => point.rwnd < point.cwnd).length;
      const congestionLimited = points.length - flowLimited;
      return {
        data: { fastRetransmits, timeouts, flowLimited, congestionLimited },
        frames: [{
          title: '重传触发与发送瓶颈',
          summary: `快重传 ${fastRetransmits} 次，超时 ${timeouts} 次，接收窗口较小的采样点 ${flowLimited} 个`,
          columns: ['RTT', '状态', '发送限制', '原因'],
          rows: points.map((point, rtt) => [
            rtt, tcpStates[point.state],
            point.rwnd < point.cwnd ? '流量控制' : point.rwnd === point.cwnd ? '两个窗口相等' : '拥塞控制',
            point.reason,
          ]),
        }],
      };
    },
  },
] };

type WindowSource = { frameCount: number; winSize: number; seqBits: number; losses: number[] };

function windowBranch(mode: WindowMode): PipelineStage {
  const label = mode === 'GBN' ? 'GBN 后退 N 帧' : 'SR 选择重传';
  return {
    id: mode.toLowerCase(), title: label, diagram: 'queue', inputs: ['source'],
    run: ({ upstream: [source] }) => {
      if (!Array.isArray(source?.losses)) return errorResult('等待上游', '连接共享帧与丢失事件源后开始模拟');
      const { frameCount, winSize, seqBits, losses } = source as WindowSource;
      const space = 2 ** seqBits;
      const limit = mode === 'GBN' ? space - 1 : space / 2;
      if (winSize > limit) return errorResult(label, `${seqBits} 位序号允许的最大窗口为 ${limit}，当前窗口为 ${winSize}`);

      const pendingLosses = new Set(losses);
      const waiting = new Set<number>();
      const buffer = new Set<number>();
      const inTransit: number[] = [];
      const retransmitted: number[] = [];
      const frames: PipelineFrame[] = [];
      let base = 0;
      let nextToSend = 0;
      let nextToDeliver = 0;
      let peakBuffer = 0;
      const frameLabel = (id: number) => `F${id}（序号 ${id % space}）`;
      const list = (ids: Iterable<number>) => [...ids].map(frameLabel).join('、') || '空';
      const show = (title: string, summary: string) => {
        const sendWindow = Array.from({ length: Math.min(winSize, frameCount - base) }, (_, i) => base + i);
        frames.push({
          title: `${frames.length + 1} · ${title}`, summary,
          columns: ['观察项', '帧号和线上序号'],
          rows: [
            ['发送窗口', list(sendWindow)],
            ['在途帧', list(inTransit)],
            ['等待确认', list(waiting)],
            ['下一个按序交付的帧', nextToDeliver < frameCount ? frameLabel(nextToDeliver) : '全部交付'],
            ['乱序接收缓存', list(buffer)],
          ],
        });
      };
      while (base < frameCount) {
        const sent: number[] = [];
        while (nextToSend < frameCount && nextToSend < base + winSize) {
          waiting.add(nextToSend);
          inTransit.push(nextToSend);
          sent.push(nextToSend++);
        }
        if (sent.length) show('发送', `发送 ${list(sent)}`);
        if (!inTransit.length) {
          const retry = mode === 'GBN' ? [...waiting] : [base];
          retransmitted.push(...retry);
          inTransit.push(...retry);
          show('超时重传', `重传 ${list(retry)}`);
        }
        const id = inTransit.shift()!;
        if (pendingLosses.delete(id)) {
          show('丢帧', `${frameLabel(id)} 首次发送时丢失`);
          continue;
        }
        if (mode === 'GBN' && id !== nextToDeliver) {
          show('丢弃乱序帧', `GBN 等待 ${frameLabel(nextToDeliver)}，累计确认保持原位`);
          continue;
        }
        waiting.delete(id);
        while (base < nextToSend && !waiting.has(base)) base++;
        if (id !== nextToDeliver) {
          buffer.add(id);
          peakBuffer = Math.max(peakBuffer, buffer.size);
          show('缓存乱序帧', `单独确认 ${frameLabel(id)}，等待缺口补齐后交付`);
          continue;
        }
        const delivered = [nextToDeliver++];
        while (buffer.delete(nextToDeliver)) delivered.push(nextToDeliver++);
        const ack = mode === 'GBN' ? '累计确认' : '单独确认';
        show('按序交付', `${ack} ${frameLabel(id)}，交付 ${list(delivered)}`);
      }
      return {
        data: { retransmitted, peakBuffer, sentCount: frameCount + retransmitted.length },
        frames,
      };
    },
  };
}

const slidingWindow: PipelineDefinition = { stages: [
  {
    id: 'source', title: '共享帧与丢失事件源', diagram: 'source',
    text: '2', textLabel: '首次发送时丢失的帧号，从 0 开始，逗号或空格分隔',
    controls: [
      { key: 'frameCount', label: '总帧数', value: 10, min: 1, max: 32, step: 1 },
      { key: 'winSize', label: '发送窗口大小', value: 4, min: 1, max: 32, step: 1 },
      { key: 'seqBits', label: '序号位数', value: 3, min: 1, max: 5, step: 1 },
    ],
    run: ({ text, params }) => {
      const frameCount = bounded(params.frameCount, 10, 1, 32);
      const winSize = bounded(params.winSize, 4, 1, 32);
      const seqBits = bounded(params.seqBits, 3, 1, 5);
      const tokens = text.slice(0, 4096).split(/[\s,，、;；]+/).filter(Boolean);
      const valid = tokens.filter(token => /^\d+$/.test(token) && Number(token) < frameCount);
      const losses = [...new Set(valid.map(Number))].sort((a, b) => a - b);
      const space = 2 ** seqBits;
      const invalid = tokens.length - valid.length;
      const warnings = [
        invalid ? `已忽略 ${invalid} 个无效帧号` : '',
        text.length > 4096 ? '丢帧输入最多读取 4096 字符' : '',
      ].filter(Boolean);
      return {
        data: { frameCount, winSize, seqBits, losses },
        frames: [{
          title: '两种协议共享相同的首次丢失',
          summary: [`线上序号以 ${space} 为模数循环。GBN 窗口上限 ${space - 1}，SR 窗口上限 ${space / 2}`, ...warnings].join('。'),
          columns: ['帧号', '线上序号', '首次发送'],
          rows: Array.from({ length: frameCount }, (_, id) => [id, id % space, losses.includes(id) ? '丢失' : '通过']),
          highlightRows: losses,
        }],
      };
    },
  },
  windowBranch('GBN'),
  windowBranch('SR'),
  {
    id: 'comparison', title: '重传代价对比', diagram: 'summary', inputs: ['gbn', 'sr'],
    run: ({ upstream: [gbn, sr] }) => {
      if (!Array.isArray(gbn?.retransmitted) || !Array.isArray(sr?.retransmitted)) {
        const errors = [gbn?.error && `GBN：${gbn.error}`, sr?.error && `SR：${sr.error}`].filter(Boolean).join('；');
        return errorResult('等待两条协议分支', errors || '连接 GBN 与 SR 的仿真结果后比较重传代价');
      }
      const saved = gbn.retransmitted.length - sr.retransmitted.length;
      return {
        data: { saved },
        frames: [{
          title: '同一丢帧源下的发送和缓存开销',
          summary: `SR 少重传 ${saved} 次，乱序接收缓存峰值为 ${sr.peakBuffer} 帧`,
          columns: ['协议', '总发送次数', '重传次数', '重传帧号（按顺序）', '接收缓存峰值'],
          rows: [
            ['GBN', Number(gbn.sentCount), gbn.retransmitted.length, gbn.retransmitted.join('、') || '无', Number(gbn.peakBuffer)],
            ['SR', Number(sr.sentCount), sr.retransmitted.length, sr.retransmitted.join('、') || '无', Number(sr.peakBuffer)],
          ],
        }],
      };
    },
  },
] };

const ipv4Header = 20;

function readCidr(text: string) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*\/\s*(\d{1,2})$/.exec(text.trim());
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (prefix > 32 || octets.some(octet => octet > 255)) return null;
  return { ip: octets.reduce((value, octet) => value * 256 + octet, 0), prefix };
}

function ipText(value: number) {
  return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.');
}

function maskFor(prefix: number) {
  return 2 ** 32 - 2 ** (32 - prefix);
}

function ipBits(value: number) {
  return value.toString(2).padStart(32, '0').match(/.{8}/g)?.join(' ') ?? '';
}

type Fragment = { totalLength: number; payload: number; offset: number; mf: number };

const ip: PipelineDefinition = { stages: [
  {
    id: 'source', title: 'IPv4 数据报输入', diagram: 'source',
    text: '192.168.1.70/26', textLabel: '目的 IPv4 地址与前缀，例如 192.168.1.70/26',
    controls: [{ key: 'totalLength', label: '数据报总长度（字节）', value: 4000, min: 20, max: 65535, step: 1 }],
    run: ({ text, params }) => {
      const cidr = readCidr(text);
      if (!cidr) return errorResult('IPv4 输入无效', '输入四段 0～255 的 IPv4 地址和 /0～/32 前缀');
      const totalLength = bounded(params.totalLength, 4000, ipv4Header, 65535);
      return {
        data: { ...cidr, totalLength },
        frames: [{
          title: '待转发数据报', summary: '采用 20 字节 IPv4 首部，允许分片',
          columns: ['目的地址', '学习用前缀', '首部', '数据', '总长度'],
          rows: [[ipText(cidr.ip), `/${cidr.prefix}`, ipv4Header, totalLength - ipv4Header, totalLength]],
        }],
      };
    },
  },
  {
    id: 'cidr', title: 'CIDR 地址与掩码', diagram: 'bits', inputs: ['source'],
    run: ({ upstream: [source] }) => {
      if (typeof source?.ip !== 'number') return errorResult('等待上游', '连接有效的 IPv4 数据报输入后计算地址块');
      const prefix = Number(source.prefix);
      const mask = maskFor(prefix);
      const network = (source.ip & mask) >>> 0;
      const count = 2 ** (32 - prefix);
      const end = network + count - 1;
      const usable = prefix >= 31 ? count : count - 2;
      const broadcast = prefix >= 31 ? '' : ipText(end);
      return {
        data: { ...source, network: ipText(network), broadcast, mask: ipText(mask), count, usable },
        frames: [{
          title: `${ipText(network)}/${prefix} 地址块`,
          summary: prefix === 31
            ? '点对点 /31 的两个地址均可使用'
            : prefix === 32 ? '主机路由精确指向一个地址' : `共 ${count} 个地址，可用主机地址 ${usable} 个`,
          columns: ['字段', '十进制 IPv4', '32 位二进制'],
          rows: [
            ['目的地址', ipText(source.ip), ipBits(source.ip)],
            ['掩码', ipText(mask), ipBits(mask)],
            ['网络地址', ipText(network), ipBits(network)],
            [prefix >= 31 ? '地址块末尾' : '广播地址', ipText(end), ipBits(end)],
            ['首个可用地址', ipText(network + Number(prefix < 31)), ipBits(network + Number(prefix < 31))],
            ['末个可用地址', ipText(end - Number(prefix < 31)), ipBits(end - Number(prefix < 31))],
          ],
        }],
      };
    },
  },
  {
    id: 'fragments', title: 'MTU 分片与片偏移', diagram: 'array', inputs: ['cidr'],
    controls: [{ key: 'mtu', label: '出链路 MTU（字节）', value: 1500, min: 68, max: 65535, step: 1 }],
    run: ({ upstream: [cidr], params }) => {
      if (typeof cidr?.ip !== 'number') return errorResult('等待上游', '连接 CIDR 地址结果后计算分片');
      const mtu = bounded(params.mtu, 1500, 68, 65535);
      const maxPayload = mtu - ipv4Header;
      const alignedPayload = Math.floor(maxPayload / 8) * 8;
      const length = Number(cidr.totalLength) - ipv4Header;
      const fragments: Fragment[] = [];
      let position = 0;
      do {
        const remaining = length - position;
        const payload = remaining > maxPayload ? alignedPayload : remaining;
        fragments.push({ totalLength: payload + ipv4Header, payload, offset: position / 8, mf: Number(remaining > payload) });
        position += payload;
      } while (position < length);
      const frames: PipelineFrame[] = [];
      const rowsPerFrame = 12;
      for (let start = 0; start < fragments.length; start += rowsPerFrame) {
        const page = fragments.slice(start, start + rowsPerFrame);
        frames.push({
          title: fragments.length === 1 ? '数据报可直接发送' : `分片 ${start + 1}～${start + page.length} / ${fragments.length}`,
          summary: `MTU ${mtu} 字节，非末片的最大数据长度为 ${alignedPayload} 字节，片偏移以 8 字节为单位`,
          columns: ['片号', '总长度', '数据长度', 'MF', '片偏移', '起始字节'],
          rows: page.map((fragment, index) => [
            start + index + 1, fragment.totalLength, fragment.payload, fragment.mf, fragment.offset, fragment.offset * 8,
          ]),
        });
      }
      return { data: { ...cidr, fragments }, frames };
    },
  },
  {
    id: 'routing', title: '最长前缀匹配与转发', diagram: 'network', inputs: ['fragments'],
    text: '0.0.0.0/0 默认网关\n192.168.1.0/24 路由器 A\n192.168.1.64/26 路由器 B\n192.168.1.128/25 路由器 C',
    textLabel: '路由表每行填写一个 CIDR 前缀和下一跳，以空格分隔',
    run: ({ text, upstream: [datagram] }) => {
      if (typeof datagram?.ip !== 'number') return errorResult('等待上游', '连接 MTU 分片结果后逐条检查路由');
      const destination = datagram.ip;
      const fragments = Array.isArray(datagram.fragments) ? datagram.fragments.length : 0;
      const routes = text.slice(0, 8192).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const entries = routes.slice(0, 64).map(line => {
        const parts = /^(\S+)\s+(.+)$/.exec(line);
        const address = parts && readCidr(parts[1] ?? '');
        if (!address) return { line };
        const mask = maskFor(address.prefix);
        const network = (address.ip & mask) >>> 0;
        const maskedDestination = (destination & mask) >>> 0;
        return {
          cidr: `${ipText(network)}/${address.prefix}`, prefix: address.prefix, nextHop: parts[2] ?? '',
          line, maskedDestination, network,
        };
      });
      const matches = entries.filter(entry => entry.cidr && entry.network === entry.maskedDestination);
      const selected = matches.reduce<(typeof matches)[number] | undefined>((best, entry) =>
        !best || Number(entry.prefix) > Number(best.prefix) ? entry : best, undefined);
      const summary = selected
        ? `${ipText(destination)} 命中最长前缀 ${selected.cidr}，向 ${selected.nextHop} 转发 ${fragments} 个数据报/分片`
        : `${ipText(destination)} 未命中路由，数据报丢弃`;
      return {
        data: { nextHop: selected?.nextHop, matches: matches.map(entry => entry.cidr) },
        frames: [{
          title: '按前缀长度选取下一跳',
          summary: [summary, routes.length > 64 || text.length > 8192 ? '路由表最多读取 64 行、8192 字符' : ''].filter(Boolean).join('。'),
          columns: ['路由前缀', '下一跳', '目的地址与掩码按位与', '匹配解释'],
          rows: entries.map(entry => {
            if (!entry.cidr) return [entry.line, '—', '—', '无效路由，需要 CIDR 前缀和下一跳'];
            const masked = ipText(entry.maskedDestination);
            const network = ipText(entry.network);
            const explanation = entry === selected ? `等于 ${network}，最长前缀，选中`
              : entry.network !== entry.maskedDestination ? `与 ${network} 不同`
              : entry.prefix === selected?.prefix ? `等于 ${network}，同长度保留在前的路由`
              : `等于 ${network}，命中较短前缀`;
            return [entry.cidr, entry.nextHop, masked, explanation];
          }),
          highlightRows: selected ? [entries.indexOf(selected)] : [],
        }],
      };
    },
  },
] };

export const netPipelines: Record<string, PipelineDefinition> = {
  tcpCongestionLab: tcp,
  slidingWindowLab: slidingWindow,
  ipSubnet: ip,
};
