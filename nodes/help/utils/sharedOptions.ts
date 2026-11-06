import { IDisplayOptions, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

/**
 * 输入条目批处理。界面与飞书节点一致：Items per Batch、Batch Interval (Ms)。
 * 只加在没有分页、也不是列表查询的操作上。未添加时仍逐条串行。
 */
export const requestBatchingOption: INodeProperties = {
	displayName: 'Batching',
	name: 'batching',
	placeholder: 'Add Batching',
	type: 'fixedCollection',
	typeOptions: {
		multipleValues: false,
	},
	default: {
		batch: {},
	},
	options: [
		{
			displayName: 'Batching',
			name: 'batch',
			values: [
				{
					displayName: 'Items per Batch',
					name: 'batchSize',
					type: 'number',
					typeOptions: {
						minValue: 1,
					},
					default: 50,
					description: '每批并发请求数量。添加此选项后启用并发模式。0 将被视为 1',
				},
				{
					displayName: 'Batch Interval (Ms)',
					name: 'batchInterval',
					type: 'number',
					typeOptions: {
						minValue: 0,
					},
					default: 1000,
					description: '每批请求之间的时间（毫秒）。0 表示禁用',
				},
			],
		},
	],
};

/**
 * 通用 Proxy 节点参数。留空表示不走代理。
 * 地址格式与 n8n HTTP Request 节点一致：http://user:pass@host:port。
 */
export const proxyOption: INodeProperties = {
	displayName: 'Proxy',
	name: 'proxy',
	type: 'string',
	default: '',
	placeholder: 'e.g. http://myproxy:3128',
	description: 'HTTP 代理地址，可带账号密码：http://user:pass@host:port。留空则不使用代理',
};

/**
 * 通用 Timeout 节点参数。默认 0 = 沿用 n8n httpRequest 默认超时。
 */
export function timeoutOption(opts?: { defaultMs?: number }): INodeProperties {
	return {
		displayName: 'Timeout',
		name: 'timeout',
		type: 'number',
		default: opts?.defaultMs ?? 0,
		typeOptions: { minValue: 0 },
		description: '请求超时时间，单位毫秒（ms）。0 表示不超时',
	};
}

/**
 * 通用 Batching 配置：控制自动翻页的请求节奏。
 *
 * - enabled = 用户是否在 Options 里显式添加了 Batching 子项；
 * - batchSize / batchInterval = 实际生效值（未启用时为默认值）。
 */
export interface IBatchConfig {
	enabled: boolean;
	batchSize: number;
	batchInterval: number;
}

/** Batching 默认值：每批 3 个请求，间隔 1000ms（约 3 次/秒）。 */
export const DEFAULT_BATCH_SIZE = 3;
export const DEFAULT_BATCH_INTERVAL_MS = 1000;

/**
 * 通用分页参数。界面与 Moka People「查询员工任职数据」一致：Return All + Limit。
 */
export const paginationOptions = {
	returnAll: {
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
	} as INodeProperties,

	/**
	 * @param maxValue Limit 上限。默认 200，与员工任职数据一致。
	 */
	limit: (maxValue = 200): INodeProperties => ({
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: {
			minValue: 1,
			maxValue,
		},
		displayOptions: {
			show: {
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	}),
};

/**
 * 通用 Batching 节点参数（fixedCollection 形式）。
 * 游标分页只能串行，Batch Size 与 Batch Interval 一起决定相邻请求的间隔。
 */
export function batchingOption(opts?: {
	/** 自定义可见性，例如 `{ '/returnAll': [true] }`。键以 `/` 开头表示根级参数路径 */
	showWhen?: IDisplayOptions['show'];
	batchSize?: number;
	batchInterval?: number;
}): INodeProperties {
	const display: Pick<INodeProperties, 'displayOptions'> = opts?.showWhen
		? { displayOptions: { show: opts.showWhen } }
		: {};
	return {
		displayName: 'Batching',
		name: 'batching',
		type: 'fixedCollection',
		placeholder: 'Add Batching',
		default: {},
		description: '自动翻页时的请求节奏，默认约 3 次/秒。间隔约为 Batch Interval / Batch Size。',
		...display,
		options: [
			{
				name: 'config',
				displayName: 'Batching',
				values: [
					{
						displayName: 'Batch Size',
						name: 'batchSize',
						type: 'number',
						default: opts?.batchSize ?? DEFAULT_BATCH_SIZE,
						typeOptions: { minValue: 1 },
						description: '每批请求数量。与 Batch Interval 一起决定串行翻页间隔。',
					},
					{
						displayName: 'Batch Interval',
						name: 'batchInterval',
						type: 'number',
						default: opts?.batchInterval ?? DEFAULT_BATCH_INTERVAL_MS,
						typeOptions: { minValue: 0 },
						description: '相邻两批请求之间的等待时间，单位毫秒（ms）。',
					},
				],
			},
		],
	};
}

/**
 * 从节点参数读取 Batching 配置。
 * 未展开 Batching 时使用默认值（3 次 / 1000ms）。
 */
/**
 * 从 Options 读取本次请求共用的 timeout 与 proxy。
 * timeout 为 0 表示不设置超时；proxy 为空字符串表示不使用代理。
 */
export function readRequestOptions(
	this: IExecuteFunctions,
	index: number,
	parentParam: string = 'options',
): { timeout: number; proxy: string } {
	const params = this.getNodeParameter(parentParam, index, {}) as {
		timeout?: number;
		proxy?: string;
	};
	const timeout = Number(params.timeout ?? 0);
	return {
		timeout: timeout > 0 ? timeout : 0,
		proxy: typeof params.proxy === 'string' ? params.proxy.trim() : '',
	};
}

export function readBatchConfig(
	this: IExecuteFunctions,
	index: number,
	parentParam: string = 'options',
): IBatchConfig {
	const params = this.getNodeParameter(parentParam, index, {}) as {
		batching?: { config?: { batchSize?: number; batchInterval?: number } };
	};
	const config = params?.batching?.config;
	return {
		enabled: !!config,
		batchSize: Math.max(1, Number(config?.batchSize ?? DEFAULT_BATCH_SIZE)),
		batchInterval: Math.max(0, Number(config?.batchInterval ?? DEFAULT_BATCH_INTERVAL_MS)),
	};
}
