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
 * 获取候选人信息
 * GET /api-platform/v1/data/ehrApplications
 * https://www.mokahr.com/docs/api/view/v2.html#-5
 *
 * applicationId 与 stage 必须传其一。有 applicationId 时其它参数无效。
 * stage=all 只含 Offer 阶段和待入职，不是全部招聘阶段。
 * 每页最多 20 条。order=ASC 时即使没有更多数据也会返回 next，用于增量拉取。
 * 示例响应没有业务 code，线上会返回 code 0 且 msg 为 success。data 与 next 在顶层。
 */

const PATH = '/api-platform/v1/data/ehrApplications';
const MAX_PAGE_SIZE = 20;
const STAGES = ['offer', 'pending_checkin', 'all'] as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface IPage {
	list: IDataObject[];
	next: string;
}

type QueryMode = 'ids' | 'cursor' | 'stage';

interface IQuery {
	mode: QueryMode;
	params: Record<string, string>;
}

function parseStringList(raw: unknown): string[] {
	if (raw === undefined || raw === null || raw === '') return [];
	if (Array.isArray(raw)) {
		return raw.flatMap((item) => parseStringList(item));
	}
	if (typeof raw !== 'string') {
		const text = String(raw).trim();
		return text ? [text] : [];
	}

	const trimmed = raw.trim();
	if (!trimmed) return [];

	if (trimmed.startsWith('[')) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.flatMap((item) => parseStringList(item));
			}
		} catch {
			// 回退到分隔符拆分
		}
	}

	return trimmed
		.split(/[，,\s\n]+/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function parseApplicationIds(raw: unknown): string[] {
	return parseStringList(raw).map((part) => {
		if (!/^[1-9]\d*$/.test(part)) {
			throw new Error('申请 ID 必须是正整数');
		}
		const value = Number(part);
		if (!Number.isSafeInteger(value)) {
			throw new Error('申请 ID 超出安全整数范围');
		}
		return part;
	});
}

function parseOptionalString(raw: unknown): string | undefined {
	if (raw === undefined || raw === null) return undefined;
	const text = String(raw).trim();
	return text ? text : undefined;
}

function parseEnumInt(raw: unknown, allowed: number[], label: string): number | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
	if (!allowed.includes(value)) {
		throw new Error(`${label} 只能是 ${allowed.join('、')}`);
	}
	return value;
}

function parseTimestamp(raw: unknown, label: string): number | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw)) throw new Error(`${label}不是有效时间`);
		return raw;
	}
	const text = String(raw).trim();
	if (!text) return undefined;
	if (/^\d+$/.test(text)) return Number(text);
	const ms = Date.parse(text);
	if (Number.isNaN(ms)) throw new Error(`${label}不是有效时间`);
	return ms;
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
	if (Array.isArray(response)) {
		return { list: response.filter(isRecord), next: '' };
	}
	if (!isRecord(response)) return { list: [], next: '' };
	if (response.success === false) {
		throw new Error(String(response.msg || response.message || '获取候选人信息失败'));
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

function recordKey(item: IDataObject): string {
	const applicationId = item.applicationId;
	if (applicationId === undefined || applicationId === null || applicationId === '') return '';
	return String(applicationId);
}

function takeNew(list: IDataObject[], seen: Set<string>): IDataObject[] {
	const fresh: IDataObject[] = [];
	for (const item of list) {
		const key = recordKey(item);
		if (!key) {
			fresh.push(item);
			continue;
		}
		if (seen.has(key)) continue;
		seen.add(key);
		fresh.push(item);
	}
	return fresh;
}

function attachNext(records: IDataObject[], next: string): IDataObject[] {
	if (!next || records.length === 0) return records;
	const lastIndex = records.length - 1;
	return records.map((item, itemIndex) => (itemIndex === lastIndex ? { ...item, next } : item));
}

function buildQuery(
	applicationIdsRaw: unknown,
	stageRaw: unknown,
	orderRaw: unknown,
	nextRaw: unknown,
	filters: IDataObject,
): IQuery {
	const applicationIds = parseApplicationIds(applicationIdsRaw);
	if (applicationIds.length > 0) {
		return { mode: 'ids', params: { applicationId: applicationIds.join(',') } };
	}

	const next = parseOptionalString(nextRaw);
	if (next) return { mode: 'cursor', params: { next } };

	const stage = parseOptionalString(stageRaw);
	if (!stage || !STAGES.includes(stage as (typeof STAGES)[number])) {
		throw new Error('申请 ID 和阶段必须填写一个。阶段只能是 offer、pending_checkin、all');
	}

	const order = parseOptionalString(orderRaw) ?? 'DESC';
	if (order !== 'DESC' && order !== 'ASC') {
		throw new Error('排序只能是 DESC 或 ASC');
	}

	const params: Record<string, string> = { stage, order };
	const email = parseOptionalString(filters.email);
	const phone = parseOptionalString(filters.phone);
	const invitationUpdateStatus = parseEnumInt(
		filters.invitationUpdateStatus,
		[0, 1, 2],
		'邀请更新状态',
	);
	const movedStart = parseTimestamp(filters.movedAtStartTime, '阶段移动开始时间');
	const movedEnd = parseTimestamp(filters.movedAtEndTime, '阶段移动结束时间');

	if (email) params.email = email;
	if (phone) params.phone = phone;
	if (invitationUpdateStatus !== undefined) {
		params.invitationUpdateStatus = String(invitationUpdateStatus);
	}
	if (movedStart !== undefined || movedEnd !== undefined) {
		if (movedStart === undefined || movedEnd === undefined) {
			throw new Error('阶段移动时间需要同时填写开始和结束');
		}
		if (movedEnd < movedStart) {
			throw new Error('阶段移动结束时间不能早于开始时间');
		}
		params.movedAtStartTime = new Date(movedStart).toISOString();
		params.movedAtEndTime = new Date(movedEnd).toISOString();
	}

	return { mode: 'stage', params };
}

const operation: ResourceOperations = {
	name: '获取候选人信息',
	value: 'getEhrApplications',
	description: '按申请 ID 或 Offer、待入职阶段查询候选人',
	action: '',
	order: 80,
	options: [
		{
			displayName:
				'申请 ID 和阶段必须填一个。填写申请 ID 后，阶段和其他条件都不会提交。阶段里的 all 只含 Offer 和待入职。每页最多 20 条。从旧到新时，即使没有更多数据也会返回 next；取完或达到 Limit 时，最后一条会带上 next。简历链接 1 小时有效。',
			name: 'noticeGetEhrApplications',
			type: 'notice',
			default: '',
		},
		paginationOptions.returnAll,
		paginationOptions.limit(),
		{
			displayName: '申请 ID 列表',
			name: 'applicationIds',
			type: 'string',
			default: '',
			placeholder: '81,82,83',
			description: '多个用逗号或换行分隔，也可以用表达式返回数组。填写后只按申请 ID 查询，不翻页',
		},
		{
			displayName: '阶段',
			name: 'stage',
			type: 'options',
			default: '',
			options: [
				{ name: '不选择', value: '' },
				{ name: 'Offer', value: 'offer' },
				{ name: '待入职', value: 'pending_checkin' },
				{ name: 'Offer 与待入职', value: 'all' },
			],
			description: '未填申请 ID 时必填。all 只包含 Offer 类型阶段和待入职，不是全部招聘阶段',
		},
		{
			displayName: '排序',
			name: 'order',
			type: 'options',
			default: 'DESC',
			options: [
				{ name: '从新到旧', value: 'DESC' },
				{ name: '从旧到新', value: 'ASC' },
			],
			description: '按进入当前阶段的时间排序。从旧到新适合增量拉取，响应总会带 next',
		},
		{
			displayName: '起始游标',
			name: 'next',
			type: 'string',
			default: '',
			placeholder: '47168265',
			description: '接着上次拉取。填写后本次只提交 next，不再带阶段和筛选条件',
		},
		{
			displayName: '筛选条件',
			name: 'filters',
			type: 'collection',
			placeholder: 'Add Filter',
			default: {},
			options: [
				{
					displayName: '邮箱',
					name: 'email',
					type: 'string',
					default: '',
					placeholder: 'name@example.com',
					description: '候选人邮箱。填写申请 ID 或起始游标后不会提交',
				},
				{
					displayName: '手机号',
					name: 'phone',
					type: 'string',
					default: '',
					placeholder: '13800000000',
					description: '候选人手机号。填写申请 ID 或起始游标后不会提交',
				},
				{
					displayName: '邀请更新状态',
					name: 'invitationUpdateStatus',
					type: 'options',
					default: '',
					options: [
						{ name: '不筛选', value: '' },
						{ name: '未邀请', value: 0 },
						{ name: '未更新', value: 1 },
						{ name: '已更新', value: 2 },
					],
					description: '未邀请为 0，未更新为 1，已更新为 2',
				},
				{
					displayName: '阶段移动开始时间',
					name: 'movedAtStartTime',
					type: 'dateTime',
					default: '',
					description: '移动到当前阶段的开始时间。需和结束时间一起填，请求里为 UTC ISO 时间',
				},
				{
					displayName: '阶段移动结束时间',
					name: 'movedAtEndTime',
					type: 'dateTime',
					default: '',
					description: '移动到当前阶段的结束时间。需和开始时间一起填，请求里为 UTC ISO 时间',
				},
			],
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
		const filters = this.getNodeParameter('filters', index, {}) as IDataObject;

		let query: IQuery;
		try {
			query = buildQuery(
				this.getNodeParameter('applicationIds', index, ''),
				this.getNodeParameter('stage', index, ''),
				this.getNodeParameter('order', index, 'DESC'),
				this.getNodeParameter('next', index, ''),
				filters,
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
			return readPage(response);
		};

		if (query.mode === 'ids') {
			const page = await requestPage(query.params);
			return page.list;
		}

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
		const seenIds = new Set<string>();
		const seenCursors = new Set<string>();
		let cursor = query.params.next ?? '';
		let pageIndex = 0;
		let resumeNext = '';

		while (collected.length < limit) {
			if (pageIndex > 0 && perRequestDelay > 0) {
				await sleep(perRequestDelay);
			}
			if (cursor) {
				if (seenCursors.has(cursor)) {
					resumeNext = cursor;
					break;
				}
				seenCursors.add(cursor);
			}

			const room = limit - collected.length;
			const pageSize = Math.min(MAX_PAGE_SIZE, room);
			const params: Record<string, string> =
				cursor || query.mode === 'cursor'
					? { next: cursor || query.params.next, limit: String(pageSize) }
					: { ...query.params, limit: String(pageSize) };
			const page = await requestPage(params);
			const fresh = takeNew(page.list, seenIds);
			if (fresh.length === 0) {
				resumeNext = page.next;
				break;
			}

			const take = fresh.slice(0, room);
			collected.push(...take);
			const truncated = take.length < fresh.length;
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
