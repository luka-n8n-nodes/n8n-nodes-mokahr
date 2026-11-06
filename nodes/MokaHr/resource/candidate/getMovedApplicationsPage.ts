import { IDataObject, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import {
	batchingOption,
	paginationOptions,
	proxyOption,
	readBatchConfig,
	readRequestOptions,
	timeoutOption,
} from '../../../help/utils/sharedOptions';

/**
 * 获取全部阶段下的候选人信息（分页）
 * GET /api-platform/v1/data/movedApplications
 * https://www.mokahr.com/docs/api/view/v2.html#-9
 *
 * 路径是 movedApplications，不是不带分页那个 moved_applications。
 * fromTime 与 next 二选一。翻页时只传 next。每页最多 20 条。
 * reqType=update 会标记已返回数据；all 忽略标记并全量返回。
 * 示例响应没有业务 code，线上会返回 code 0 且 msg 为 success。data 与 next 在顶层。
 */

const PATH = '/api-platform/v1/data/movedApplications';
const MAX_PAGE_SIZE = 20;
const STAGES = [
	'all',
	'preliminary_filter',
	'offer',
	'pending_checkin',
	'filter',
	'interview',
	'exam',
	'none',
	'shigong',
] as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface IPage {
	list: IDataObject[];
	next: string;
}

interface IQuery {
	params: Record<string, string>;
	cursor: string;
}

function parseOptionalString(raw: unknown): string | undefined {
	if (raw === undefined || raw === null) return undefined;
	const text = String(raw).trim();
	return text ? text : undefined;
}

/**
 * 日期选择器按本机日历日转成文档示例那样的 YYYY-M-D。
 * 已经是日期的字符串原样使用。
 */
function formatApiDate(raw: unknown, label: string): string | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	if (typeof raw === 'string') {
		const text = raw.trim();
		if (!text) return undefined;
		if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) return text;
		if (/^\d+$/.test(text)) return formatApiDate(Number(text), label);
	}

	const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
	if (!Number.isFinite(ms)) throw new Error(`${label}不是有效时间`);
	const date = new Date(ms);
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function isRecord(value: unknown): value is IDataObject {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNext(next: unknown): string {
	if (typeof next === 'string') return next.trim();
	if (typeof next === 'number' && Number.isFinite(next)) return String(next);
	return '';
}

function readPage(response: unknown): IPage {
	if (!isRecord(response)) return { list: [], next: '' };
	if (response.success === false) {
		throw new Error(String(response.msg || response.message || '获取全部阶段下的候选人信息失败'));
	}
	const list = Array.isArray(response.data) ? response.data.filter(isRecord) : [];
	return { list, next: readNext(response.next) };
}

function buildQueryPath(params: Record<string, string>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== '') search.set(key, value);
	}
	const qs = search.toString();
	return qs ? `${PATH}?${qs}` : PATH;
}

function attachNext(records: IDataObject[], next: string): IDataObject[] {
	if (!next || records.length === 0) return records;
	const lastIndex = records.length - 1;
	return records.map((item, itemIndex) => (itemIndex === lastIndex ? { ...item, next } : item));
}

function buildQuery(
	stageRaw: unknown,
	fromTimeRaw: unknown,
	reqTypeRaw: unknown,
	nextRaw: unknown,
): IQuery {
	const cursor = parseOptionalString(nextRaw) ?? '';
	if (cursor) return { params: {}, cursor };

	const fromTime = formatApiDate(fromTimeRaw, '开始时间');
	if (!fromTime) {
		throw new Error('开始时间不能为空。接着上次拉取时改填起始游标');
	}

	const stage = parseOptionalString(stageRaw);
	if (stage && !STAGES.includes(stage as (typeof STAGES)[number])) {
		throw new Error('阶段不在可选范围内');
	}

	const reqType = parseOptionalString(reqTypeRaw) ?? 'update';
	if (reqType !== 'all' && reqType !== 'update') {
		throw new Error('拉取类型只能是 all 或 update');
	}

	const params: Record<string, string> = { fromTime, reqType };
	if (stage) params.stage = stage;
	return { params, cursor: '' };
}

const operation: ResourceOperations = {
	name: '获取全部阶段下的候选人信息(分页)',
	value: 'getMovedApplicationsPage',
	description: '按开始时间分页拉取各阶段候选人，默认返回后会标记',
	action: '',
	order: 83,
	options: [
		{
			displayName:
				'开始时间必填；接着拉时只填起始游标。默认「更新」会标记已返回的数据，「全量」忽略标记。每页最多 20 条，翻页请求只带 next。达到 Limit 且还有下一页时，最后一条会带上 next。',
			name: 'noticeGetMovedApplicationsPage',
			type: 'notice',
			default: '',
		},
		paginationOptions.returnAll,
		paginationOptions.limit(),
		{
			displayName: '阶段',
			name: 'stage',
			type: 'options',
			default: '',
			// 阶段按招聘流程排列，不按名称字母序
			// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
			options: [
				{ name: '不筛选', value: '' },
				{ name: '所有阶段', value: 'all' },
				{ name: '初筛', value: 'preliminary_filter' },
				{ name: 'Offer', value: 'offer' },
				{ name: '待入职', value: 'pending_checkin' },
				{ name: '筛选型', value: 'filter' },
				{ name: '面试型', value: 'interview' },
				{ name: '测试型', value: 'exam' },
				{ name: '无类型', value: 'none' },
				{ name: '试工型', value: 'shigong' },
			],
			description: '按归档前阶段过滤。不选则不传。填写起始游标后不会提交',
		},
		{
			displayName: '开始时间',
			name: 'fromTime',
			type: 'dateTime',
			default: '',
			description:
				'第一次请求必填，从此时间往更新的数据查。按本机日历日转成 YYYY-M-D，例如 2018-1-1',
		},
		{
			displayName: '拉取类型',
			name: 'reqType',
			type: 'options',
			default: 'update',
			options: [
				{ name: '更新（返回后标记）', value: 'update' },
				{ name: '全量（忽略标记）', value: 'all' },
			],
			description: '更新只返回未标记数据并打标。全量忽略标记，全部返回',
		},
		{
			displayName: '起始游标',
			name: 'next',
			type: 'string',
			default: '',
			placeholder: '2019-01-16T07:56:44.000Z_44803',
			description: '接着上次拉取。填写后本次只提交 next，不再带开始时间和阶段',
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			options: [timeoutOption(), batchingOption({ showWhen: { '/returnAll': [true] } }), proxyOption],
		},
	],
	call: async function (index) {
		const returnAll = this.getNodeParameter('returnAll', index, false) as boolean;
		const { timeout, proxy } = readRequestOptions.call(this, index);

		let query: IQuery;
		try {
			query = buildQuery(
				this.getNodeParameter('stage', index, ''),
				this.getNodeParameter('fromTime', index, ''),
				this.getNodeParameter('reqType', index, 'update'),
				this.getNodeParameter('next', index, ''),
			);
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}

		const requestPage = async (params: Record<string, string>): Promise<IPage> => {
			const response = await mokaRequest<unknown>(this, {
				method: 'GET',
				path: buildQueryPath(params),
				itemIndex: index,
				timeout,
				proxy,
				returnFullResponse: true,
				successCodes: [0, 200],
			});
			try {
				return readPage(response);
			} catch (error) {
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error.message : String(error),
					{ itemIndex: index },
				);
			}
		};

		const limit = returnAll
			? Number.POSITIVE_INFINITY
			: Number(this.getNodeParameter('limit', index, 50));
		if (!returnAll && (!Number.isInteger(limit) || limit < 1)) {
			throw new NodeOperationError(this.getNode(), 'Limit 必须是大于等于 1 的整数', {
				itemIndex: index,
			});
		}

		const batchConfig = returnAll ? readBatchConfig.call(this, index) : undefined;
		const perRequestDelay = batchConfig
			? Math.max(1, Math.ceil(batchConfig.batchInterval / Math.max(1, batchConfig.batchSize)))
			: 0;

		const collected: IDataObject[] = [];
		const seenCursors = new Set<string>();
		let cursor = query.cursor;
		let pageIndex = 0;
		let resumeNext = '';

		while (collected.length < limit) {
			if (pageIndex > 0 && perRequestDelay > 0) {
				await sleep(perRequestDelay);
			}
			if (cursor) {
				if (seenCursors.has(cursor)) {
					throw new NodeOperationError(this.getNode(), '分页游标重复，已停止翻页', {
						itemIndex: index,
					});
				}
				seenCursors.add(cursor);
			}

			const room = limit - collected.length;
			const pageSize = Math.min(MAX_PAGE_SIZE, room);
			const params: Record<string, string> = cursor
				? { next: cursor, limit: String(pageSize) }
				: { ...query.params, limit: String(pageSize) };
			const page = await requestPage(params);
			if (page.list.length === 0) break;

			const take = page.list.slice(0, room);
			collected.push(...take);
			const truncated = take.length < page.list.length;
			if (truncated || collected.length >= limit || !page.next) {
				resumeNext = truncated ? '' : page.next;
				break;
			}
			cursor = page.next;
			pageIndex += 1;
		}

		return attachNext(collected, resumeNext);
	},
};

export default operation;
