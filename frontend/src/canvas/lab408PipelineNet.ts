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
    presets: [
      { label: '正常慢开始→拥塞避免', text: 'ack ack ack ack ack ack', params: { ssthresh: 8, rwnd: 64 } },
      { label: '3-ACK 快重传快恢复', text: 'ack ack ack ack 3ack ack', params: { ssthresh: 8, rwnd: 64 } },
      { label: '超时重回 cwnd=1', text: 'ack ack ack timeout ack', params: { ssthresh: 8, rwnd: 64 } },
    ],
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
    presets: [
      { label: '无丢帧满窗口', text: '', params: { frameCount: 10, winSize: 4, seqBits: 3 } },
      { label: '中间帧丢失（GBN vs SR）', text: '3', params: { frameCount: 10, winSize: 4, seqBits: 3 } },
    ],
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

/* ---------- CSMA/CD ---------- */

type CsmaMetrics = {
  distance: number;
  rate: number;
  frameBytes: number;
  delayB: number;
  tau: number;
  contention: number;
  transmission: number;
  minBytes: number;
  collision: boolean;
  collisionTime: number | null;
  collisionAt: number | null;
  detectA: number | null;
  detectB: number | null;
  reliable: boolean;
};

function csmaMetrics(distance: number, rateIndex: number, frameBytes: number, delayB: number): CsmaMetrics {
  const rate = Math.round(rateIndex) === 1 ? 100 : 10;
  const tau = distance / 200;
  const contention = 2 * tau;
  const transmission = frameBytes * 8 / rate;
  const minBytes = contention * rate / 8;
  const collision = delayB < tau && delayB < transmission;
  const collisionTime = collision ? (tau + delayB) / 2 : null;
  const collisionAt = collision && tau > 0 ? distance / 2 * (1 + delayB / tau) : null;
  const detectA = collisionTime === null || collisionAt === null ? null : collisionTime + collisionAt / 200;
  const detectB = collisionTime === null || collisionAt === null ? null : collisionTime + (distance - collisionAt) / 200;
  return {
    distance, rate, frameBytes, delayB, tau, contention, transmission, minBytes,
    collision, collisionTime, collisionAt, detectA, detectB,
    reliable: transmission >= contention,
  };
}

const csmaSource: PipelineStage = {
  id: 'link', title: '链路与帧参数', diagram: 'source',
  controls: [
    { key: 'distance', label: '总线长度 m', value: 1000, min: 100, max: 2500, step: 10 },
    { key: 'rate', label: '带宽', value: 0, options: [{ value: 0, label: '10 Mbps' }, { value: 1, label: '100 Mbps' }] },
    { key: 'frameBytes', label: '帧长 Bytes', value: 64, min: 16, max: 128, step: 1 },
    { key: 'delayB', label: 'B 站相对延迟 μs', value: 2, min: 0, max: 10, step: 0.1 },
  ],
  presets: [
    { label: '标准 64 B 帧', params: { distance: 1000, rate: 0, frameBytes: 64, delayB: 2 } },
    { label: '短帧漏检', params: { distance: 2500, rate: 0, frameBytes: 16, delayB: 1 } },
    { label: 'B 站延迟较大', params: { distance: 1200, rate: 0, frameBytes: 64, delayB: 8 } },
  ],
  run({ params }) {
    const metrics = csmaMetrics(
      bounded(params.distance, 1000, 100, 2500),
      bounded(params.rate, 0, 0, 1),
      bounded(params.frameBytes, 64, 16, 128),
      Math.max(0, Math.min(10, Number.isFinite(params.delayB ?? Number.NaN) ? params.delayB! : 2)),
    );
    return {
      data: metrics,
      frames: [{
        title: '链路时延参数',
        summary: `单程传播时延 τ = d / v = ${metrics.tau.toFixed(3)} μs，争用期 2τ = ${metrics.contention.toFixed(3)} μs。`,
        columns: ['参数', '值'],
        rows: [
          ['总线长度', `${metrics.distance} m`],
          ['传播速度', '2 × 10⁸ m/s'],
          ['单程传播 τ', `${metrics.tau.toFixed(3)} μs`],
          ['争用期 2τ', `${metrics.contention.toFixed(3)} μs`],
          ['发送时延 Ttrans', `${metrics.transmission.toFixed(3)} μs`],
          ['理论最短帧长', `${metrics.minBytes.toFixed(3)} B`],
        ],
      }],
    };
  },
};

const csmaTimeline: PipelineStage = {
  id: 'timeline', title: '信号传播与碰撞', diagram: 'pipeline', inputs: ['link'],
  run({ upstream }) {
    const data = upstream[0] as CsmaMetrics | undefined;
    if (!data) return errorResult('等待链路参数', '连接链路输入后生成信号时间轴。');
    const { distance, rate, frameBytes, delayB, tau, contention, transmission, collision, collisionTime, collisionAt, detectA, detectB, reliable } = data;
    const end = Math.max(transmission, (detectB ?? 0)) + 1;
    const timeline = [
      {
        label: 'A 站', segments: [
          { label: '发送', start: 0, end: transmission },
          ...(collisionTime !== null && detectA !== null ? [{ label: '检测碰撞', start: collisionTime, end: detectA }] : []),
        ],
      },
      {
        label: 'B 站', segments: [
          { label: delayB >= tau ? '侦听到忙，延迟' : '发送', start: delayB, end: delayB + (delayB >= tau ? 0.2 : transmission) },
          ...(collisionTime !== null && detectB !== null ? [{ label: '检测碰撞', start: collisionTime, end: detectB }] : []),
        ],
      },
      { label: '争用窗口', segments: [{ label: '2τ', start: 0, end: contention }] },
    ];
    const samples = Array.from({ length: 13 }, (_, index) => index * end / 12);
    const positionsA = samples.map((time) => time <= tau ? time / Math.max(1e-9, tau) * distance : distance);
    const positionsB = samples.map((time) => time <= delayB ? distance : Math.min(distance, (time - delayB) / Math.max(1e-9, tau) * distance));
    return {
      data,
      frames: [
        {
          title: 'A / B 发送与碰撞时间轴',
          summary: collision
            ? `B 在 A 的信号到达前开始发送；碰撞点约 ${collisionAt!.toFixed(1)} m，碰撞时刻 ${collisionTime!.toFixed(3)} μs。`
            : 'B 在争用窗口内没有与 A 的发送重叠，未发生碰撞。',
          timeline,
          columns: ['事件', '时间 μs'],
          rows: [
            ['A 开始发送', 0],
            ...(collisionTime !== null ? [['碰撞发生', collisionTime], ['A 检测到碰撞', detectA ?? '—'], ['B 检测到碰撞', detectB ?? '—']] : []),
            ['B 计划发送', delayB],
          ],
          series: [{ label: 'A 信号前缘位置 (m)', values: positionsA }, { label: 'B 信号前缘位置 (m)', values: positionsB }],
        },
        {
          title: reliable ? '帧长满足可靠检测' : '帧太短，冲突漏检',
          summary: `Ttrans = ${transmission.toFixed(3)} μs，2τ = ${contention.toFixed(3)} μs，理论最短帧长 ${data.minBytes.toFixed(3)} B。`,
          columns: ['条件', '结果'],
          rows: [
            ['发送是否覆盖争用期', transmission >= contention ? '是' : '否'],
            ['A 是否在发完前检测到碰撞', detectA !== null && detectA <= transmission ? '是' : collision ? '否' : '未碰撞'],
            ['当前帧长', `${frameBytes} B`],
            ['理论最短帧长', `${data.minBytes.toFixed(3)} B`],
            ['结论', reliable ? '可可靠检测冲突' : '帧已发完，冲突可能漏检'],
          ],
          highlightRows: reliable ? [] : [4],
          series: [{ label: '帧长 (B)', values: [frameBytes, data.minBytes] }],
        },
      ],
    };
  },
};

const csmaVerdict: PipelineStage = {
  id: 'verdict', title: '最短帧长与退避', diagram: 'summary', inputs: ['timeline'],
  run({ upstream }) {
    const data = upstream[0] as CsmaMetrics | undefined;
    if (!data) return errorResult('等待碰撞结果', '连接时间轴后给出结论。');
    const backoff = Array.from({ length: 6 }, (_, attempt) => [attempt, `[0, ${2 ** attempt - 1}]`, `${2 ** attempt} 个时隙`]);
    return {
      data,
      frames: [{
        title: '可靠检测结论',
        summary: data.reliable
          ? '当前发送时延覆盖争用期，冲突信号能在帧发送结束前返回。'
          : '当前帧发送时延小于争用期，帧已发送完毕时冲突可能仍未返回，发生漏检。',
        columns: ['项', '值'],
        rows: [
          ['发送时延', `${data.transmission.toFixed(3)} μs`],
          ['争用期 2τ', `${data.contention.toFixed(3)} μs`],
          ['理论最短帧长 Lmin', `${data.minBytes.toFixed(3)} B`],
          ['当前帧长', `${data.frameBytes} B`],
          ['是否可靠检测', data.reliable ? '是' : '否'],
          ['是否发生碰撞', data.collision ? '是' : '否'],
        ],
        highlightRows: data.reliable ? [] : [4],
      }, {
        title: '二进制指数退避区间',
        summary: '第 k 次冲突后，从 [0, 2ᵏ−1] 中随机选择一个时隙等待；达到上限后区间不再翻倍。',
        columns: ['冲突次数 k', '可选时隙区间', '时隙数'],
        rows: backoff,
      }],
    };
  },
};

/* ---------- RIP / OSPF 路由收敛 ---------- */

const routeNodes = ['R1', 'R2', 'R3', 'R4', 'R5'];
type RouteEdge = { u: string; v: string; w: number };
const routeEdges: RouteEdge[] = [
  { u: 'R1', v: 'R2', w: 1 },
  { u: 'R2', v: 'R3', w: 1 },
  { u: 'R3', v: 'R4', w: 1 },
  { u: 'R4', v: 'R5', w: 1 },
];

function routeNeighbors(edges: RouteEdge[]): Map<string, { node: string; cost: number }[]> {
  const map = new Map(routeNodes.map((node) => [node, [] as { node: string; cost: number }[]]));
  for (const edge of edges) {
    map.get(edge.u)?.push({ node: edge.v, cost: edge.w });
    map.get(edge.v)?.push({ node: edge.u, cost: edge.w });
  }
  return map;
}

function ripConverge(edges: RouteEdge[], hopLimit: number, splitHorizon: boolean, broken?: RouteEdge): { frames: PipelineFrame[]; rounds: number; loop: boolean } {
  const neighbors = routeNeighbors(edges);
  const inf = 16;
  const initialEdges = broken ? [...edges, broken] : edges;
  let table = Object.fromEntries(routeNodes.map((node) => [node, Object.fromEntries(routeNodes.map((target) => [target, target === node ? 0 : inf]))]));
  let next: Record<string, Record<string, string | null>> = Object.fromEntries(routeNodes.map((node) => [node, Object.fromEntries(routeNodes.map((target) => [target, target === node ? node : null]))]));
  for (const edge of initialEdges) {
    if (edge.w < table[edge.u]![edge.v]!) { table[edge.u]![edge.v] = edge.w; next[edge.u]![edge.v] = edge.v; }
    if (edge.w < table[edge.v]![edge.u]!) { table[edge.v]![edge.u] = edge.w; next[edge.v]![edge.u] = edge.u; }
  }
  // 先建立故障前的收敛路由表，再模拟断链后的坏消息传播。
  const normalNeighbors = routeNeighbors(initialEdges);
  for (let round = 0; round < hopLimit; round += 1) {
    const oldTable = JSON.parse(JSON.stringify(table)) as typeof table;
    let changed = false;
    for (const node of routeNodes) {
      for (const neighbor of normalNeighbors.get(node) ?? []) {
        for (const dest of routeNodes) {
          const candidate = Math.min(inf, neighbor.cost + (oldTable[neighbor.node]?.[dest] ?? inf));
          if (candidate < (oldTable[node]?.[dest] ?? inf)) {
            table[node]![dest] = candidate;
            next[node]![dest] = neighbor.node;
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
  if (broken && !splitHorizon) return ripCountFrames(table, next, neighbors, inf, hopLimit);
  if (broken) {
    const endpoints = new Set([broken.u, broken.v]);
    for (const node of endpoints) {
      for (const target of routeNodes) {
        const hop = next[node]![target];
        if (hop && endpoints.has(hop)) {
          table[node]![target] = inf;
          next[node]![target] = null;
        }
      }
    }
  }
  const frames: PipelineFrame[] = [];
  for (let round = 1; round <= hopLimit; round += 1) {
    const oldTable = JSON.parse(JSON.stringify(table)) as typeof table;
    const oldNext = JSON.parse(JSON.stringify(next)) as typeof next;
    let changed = false;
    const changedRows: number[] = [];
    for (const node of routeNodes) {
      for (const neighbor of neighbors.get(node) ?? []) {
        for (const dest of routeNodes) {
          if (splitHorizon && oldNext[node]?.[dest] === neighbor.node) continue;
          const candidate = Math.min(inf, neighbor.cost + (oldTable[neighbor.node]?.[dest] ?? inf));
          if (candidate < (oldTable[node]?.[dest] ?? inf)) {
            table[node]![dest] = candidate;
            next[node]![dest] = neighbor.node;
            changed = true;
            if (dest === 'R1' && !changedRows.includes(routeNodes.indexOf(node))) changedRows.push(routeNodes.indexOf(node));
          }
        }
      }
    }
    frames.push({
      title: `RIP 第 ${round} 轮`,
      summary: changed ? '距离向量发生更新。' : '本轮没有更新，距离向量已收敛。',
      columns: ['路由器', '到 R1 距离', '下一跳', '到 R5 距离', '下一跳'],
      rows: routeNodes.map((node) => [node, table[node]!.R1 ?? 16, next[node]!.R1 ?? '—', table[node]!.R5 ?? 16, next[node]!.R5 ?? '—']),
      highlightRows: changedRows,
    });
    if (!changed) return { frames, rounds: round, loop: false };
  }
  return { frames, rounds: hopLimit, loop: true };
}

function ripCountFrames(
  normalTable: Record<string, Record<string, number>>,
  normalNext: Record<string, Record<string, string | null>>,
  neighbors: Map<string, { node: string; cost: number }[]>,
  inf: number,
  hopLimit: number,
): { frames: PipelineFrame[]; rounds: number; loop: boolean } {
  const table = JSON.parse(JSON.stringify(normalTable)) as typeof normalTable;
  const next = JSON.parse(JSON.stringify(normalNext)) as typeof normalNext;
  table.R2!.R1 = inf;
  next.R2!.R1 = null;
  for (const target of routeNodes) {
    if (next.R1![target] === 'R2') {
      table.R1![target] = inf;
      next.R1![target] = null;
    }
  }
  const frames: PipelineFrame[] = [];
  let reached = false;
  for (let round = 1; round <= hopLimit; round += 1) {
    const oldTable = JSON.parse(JSON.stringify(table)) as typeof table;
    const oldNext = JSON.parse(JSON.stringify(next)) as typeof next;
    const changedRows: number[] = [];
    let changed = false;
    for (const node of routeNodes) {
      if (node === 'R1') continue;
      for (const neighbor of neighbors.get(node) ?? []) {
        if (oldNext[node]?.['R1'] !== null && oldNext[node]?.['R1'] !== neighbor.node) continue;
        const neighborDistance = oldTable[neighbor.node]?.['R1'] ?? inf;
        if (neighborDistance >= inf) continue;
        const candidate = Math.min(inf, neighbor.cost + neighborDistance);
        if (candidate !== oldTable[node]?.['R1']) {
          table[node]!.R1 = candidate;
          next[node]!.R1 = neighbor.node;
          changed = true;
          changedRows.push(routeNodes.indexOf(node));
          if (candidate >= inf) reached = true;
        }
      }
    }
    frames.push({
      title: `RIP 第 ${round} 轮`,
      summary: changed ? '经由旧下一跳的距离被逐轮放大。' : '距离不再变化。',
      columns: ['路由器', '到 R1 距离', '下一跳', '到 R5 距离', '下一跳'],
      rows: routeNodes.map((node) => [node, table[node]!.R1 ?? inf, next[node]!.R1 ?? '—', table[node]!.R5 ?? inf, next[node]!.R5 ?? '—']),
      highlightRows: [...new Set(changedRows)],
    });
    if (!changed) return { frames, rounds: round, loop: reached };
  }
  return { frames, rounds: hopLimit, loop: reached || true };
}

function ospfTables(edges: RouteEdge[]): PipelineFrame {
  const scores: Record<string, Record<string, number>> = {};
  for (const source of routeNodes) {
    const distance: Record<string, number> = Object.fromEntries(routeNodes.map((node) => [node, 16]));
    const visited = new Set<string>();
    distance[source] = 0;
    for (let step = 0; step < routeNodes.length; step += 1) {
      let current: string | null = null;
      let best = 16;
      for (const node of routeNodes) if (!visited.has(node) && distance[node]! < best) { best = distance[node]!; current = node; }
      if (!current) break;
      visited.add(current);
      for (const edge of edges) {
        const next = edge.u === current ? edge.v : edge.v === current ? edge.u : null;
        if (next && !visited.has(next)) distance[next] = Math.min(distance[next]!, distance[current]! + edge.w);
      }
    }
    scores[source] = distance;
  }
  return {
    title: 'OSPF 链路状态最短路',
    summary: '故障后每台路由器按链路状态重新运行 Dijkstra，一轮内得到新的最短路径表。',
    columns: ['源路由器', '到 R1 开销', '到 R3 开销', '到 R5 开销'],
    rows: routeNodes.map((node) => [node, scores[node]!.R1!, scores[node]!.R3!, scores[node]!.R5!]),
  };
}

const routingSource: PipelineStage = {
  id: 'topology', title: '路由拓扑与故障', diagram: 'source',
  controls: [
    { key: 'fault', label: '故障注入', value: 0, options: [{ value: 0, label: '正常拓扑' }, { value: 1, label: '断开 R1–R2' }] },
    { key: 'splitHorizon', label: '水平分割', value: 0, options: [{ value: 0, label: '关闭' }, { value: 1, label: '开启' }] },
    { key: 'protocol', label: '主视图协议', value: 0, options: [{ value: 0, label: 'RIP 距离向量' }, { value: 1, label: 'OSPF 链路状态' }] },
  ],
  presets: [
    { label: '正常拓扑', params: { fault: 0, splitHorizon: 0, protocol: 0 } },
    { label: '断链 · RIP 计数到无穷', params: { fault: 1, splitHorizon: 0, protocol: 0 } },
    { label: '断链 · 水平分割', params: { fault: 1, splitHorizon: 1, protocol: 0 } },
    { label: '断链 · OSPF 重算', params: { fault: 1, splitHorizon: 0, protocol: 1 } },
  ],
  run({ params }) {
    const fault = Math.round(params.fault ?? 0) === 1;
    const splitHorizon = Math.round(params.splitHorizon ?? 0) === 1;
    const protocol = Math.round(params.protocol ?? 0) === 1 ? 1 : 0;
    return {
      data: { fault, splitHorizon, protocol },
      frames: [{
        title: '路由器拓扑', columns: ['链路', '开销', '状态'],
        rows: routeEdges.map((edge) => [`${edge.u} — ${edge.v}`, edge.w, fault && edge.u === 'R1' && edge.v === 'R2' ? '断开' : '正常']),
        summary: fault ? 'R1–R2 链路断开。' : '五台路由器组成一条链式拓扑。',
      }],
    };
  },
};

const routingTopology: PipelineStage = {
  id: 'graph', title: '拓扑图与故障边', diagram: 'graph', inputs: ['topology'],
  run({ upstream }) {
    const data = upstream[0];
    if (!data) return errorResult('等待拓扑', '连接拓扑源后绘制路由图。');
    const fault = Boolean(data.fault);
    const positions = Object.fromEntries(routeNodes.map((node, index) => [node, { x: 10 + index * 20, y: 50 }]));
    return {
      data,
      frames: [{
        title: '五节点链式拓扑',
        summary: fault ? 'R1–R2 边已断开，R1 与其余节点隔离。' : '所有链路正常。',
        graph: {
          nodes: routeNodes.map((node) => ({ id: node, label: node, x: positions[node]!.x, y: positions[node]!.y, active: fault && node === 'R1' })),
          edges: routeEdges.map((edge) => ({
            from: edge.u, to: edge.v, label: `${edge.w}${fault && edge.u === 'R1' && edge.v === 'R2' ? ' ✕' : ''}`,
            active: fault && edge.u === 'R1' && edge.v === 'R2' ? false : true,
          })),
        },
        columns: ['链路', '开销', '状态'],
        rows: routeEdges.map((edge) => [`${edge.u} — ${edge.v}`, edge.w, fault && edge.u === 'R1' && edge.v === 'R2' ? '断开' : '正常']),
      }],
    };
  },
};

const routingConverge: PipelineStage = {
  id: 'converge', title: '路由收敛推演', diagram: 'grid', inputs: ['graph'],
  run({ upstream }) {
    const data = upstream[0];
    if (!data) return errorResult('等待拓扑', '连接拓扑图后收敛路由表。');
    const fault = Boolean(data.fault);
    const splitHorizon = Boolean(data.splitHorizon);
    const broken = fault ? routeEdges.find((edge) => edge.u === 'R1' && edge.v === 'R2') : undefined;
    const edges = routeEdges.filter((edge) => !(fault && edge.u === 'R1' && edge.v === 'R2'));
    const rip = ripConverge(edges, 16, splitHorizon, broken);
    const ospf = ospfTables(edges);
    const selected = Number(data.protocol) === 1 ? 1 : 0;
    return {
      data: { ...data, ripRounds: rip.rounds, ripLoop: rip.loop, ospfRounds: 1 },
      frames: selected ? [ospf] : rip.frames,
    };
  },
};

const routingCompare: PipelineStage = {
  id: 'compare', title: 'RIP / OSPF 对照', diagram: 'summary', inputs: ['converge'],
  run({ upstream }) {
    const data = upstream[0];
    if (!data) return errorResult('等待收敛结果', '连接路由收敛后比较协议。');
    const ripRounds = Number(data.ripRounds);
    const ospfRounds = Number(data.ospfRounds);
    return {
      data,
      frames: [{
        title: '距离向量与链路状态',
        summary: `RIP 收敛 ${ripRounds} 轮${data.ripLoop ? '，出现计数到无穷' : ''}；OSPF 以链路状态重算 ${ospfRounds} 轮。`,
        columns: ['协议', '收敛轮次', '报文范围', '环路风险'],
        rows: [
          ['RIP', ripRounds, '与邻居交换整张距离向量', data.ripLoop ? '存在（坏消息传得慢）' : '低'],
          ['OSPF', ospfRounds, '泛洪链路状态，区域内同步', '无距离向量环路'],
        ],
        highlightRows: data.ripLoop ? [0] : [],
      }],
    };
  },
};

export const netPipelines: Record<string, PipelineDefinition> = {
  tcpCongestionLab: tcp,
  slidingWindowLab: slidingWindow,
  ipSubnet: ip,
  csmaCdLab: { stages: [csmaSource, csmaTimeline, csmaVerdict] },
  routingLab: { stages: [routingSource, routingTopology, routingConverge, routingCompare] },
};
