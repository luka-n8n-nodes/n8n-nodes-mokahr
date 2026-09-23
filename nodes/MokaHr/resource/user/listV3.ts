import { IDataObject, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import {
	batchingOption,
	paginationOptions,
	readBatchConfig,
	timeoutOption,
} from '../../../help/utils/sharedOptions';

/**
 * 获取人事信息 V3
 * POST /open-api/ats/v3/users/list
 * https://www.mokahr.com/docs/api/
 *
 * 示例响应的成功码是 0。返回字段表写「非 200 代表失败」，与示例不一致，以示例为准。
 * 文档把 limit 标成 string，官方示例请求体里是数字。
 */

const PATH = '/open-api/ats/v3/users/list';
/** 接口单页上限。Return All 固定用这个值翻页。 */
const MAX_PAGE_SIZE = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface IUserPage {
	userList?: IDataObject[];
	nextUserId?: number | string | null;
}

interface IUserQuery {
	body: IDataObject;
	nextUserId?: number;
}

function parsePositiveInt(raw: unknown, label: string): number | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	const text = String(raw).trim();
	if (!/^[1-9]\d*$/.test(text)) {
		throw new Error(`${label} 必须是正整数`);
	}
	const value = Number(text);
	if (!Number.isSafeInteger(value)) {
		throw new Error(`${label} 超出安全整数范围`);
	}
	return value;
}

function parseEnumInt(raw: unknown, allowed: number[], label: string): number | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
	if (!allowed.includes(value)) {
		throw new Error(`${label} 只能是 ${allowed.join('、')}`);
	}
	return value;
}

function parseOptionalString(raw: unknown): string | undefined {
	if (raw === undefined || raw === null) return undefined;
	const text = String(raw).trim();
	return text ? text : undefined;
}

function parseChoice<T extends string>(
	raw: unknown,
	allowed: readonly T[],
	label: string,
): T | undefined {
	const text = parseOptionalString(raw);
	if (text === undefined) return undefined;
	const matched = allowed.find((item) => item.toLowerCase() === text.toLowerCase());
	if (!matched) {
		throw new Error(`${label} 只能是 ${allowed.join('、')}`);
	}
	return matched;
}

function readNextUserId(raw: unknown): number | undefined {
	if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) {
		return raw;
	}
	if (typeof raw === 'string' && /^[1-9]\d*$/.test(raw.trim())) {
		const value = Number(raw.trim());
		if (Number.isSafeInteger(value)) return value;
	}
	return undefined;
}

function buildQuery(filters: IDataObject): IUserQuery {
	const body: IDataObject = {};

	const userId = parsePositiveInt(filters.userId, '用户 ID');
	const roleId = parsePositiveInt(filters.roleId, '角色 ID');
	const email = parseOptionalString(filters.email);
	const phone = parseOptionalString(filters.phone);
	const number = parseOptionalString(filters.number);
	const deactivated = parseEnumInt(filters.deactivated, [0, 1], '禁用状态');
	const departmentIdType = parseChoice(
		filters.departmentIdType,
		['DEPARTMENT_ID', 'DEPARTMENT_CODE'] as const,
		'部门 ID 类型',
	);
	const departmentId = parseOptionalString(filters.departmentId);
	const locale = parseChoice(filters.locale, ['zh-CN', 'en-US'] as const, '用户语言');
	const order = parseChoice(filters.order, ['DESC', 'ASC'] as const, '排序方式');
	const nextUserId = parsePositiveInt(filters.nextUserId, '起始用户 ID');

	if (userId !== undefined) body.userId = userId;
	if (roleId !== undefined) body.roleId = roleId;
	if (email) body.email = email;
	if (phone) body.phone = phone;
	if (number) body.number = number;
	if (deactivated !== undefined) body.deactivated = deactivated;
	if (departmentIdType) body.departmentIdType = departmentIdType;
	if (departmentId) body.departmentId = departmentId;
	if (locale) body.locale = locale;
	if (order) body.order = order;

	return { body, nextUserId };
}

function takeNewUsers(list: IDataObject[], seenUserIds: Set<string>): IDataObject[] {
	const fresh: IDataObject[] = [];
	for (const item of list) {
		const userId = item.userId;
		if (userId === undefined || userId === null || userId === '') {
			fresh.push(item);
			continue;
		}
		const key = String(userId);
		if (seenUserIds.has(key)) continue;
		seenUserIds.add(key);
		fresh.push(item);
	}
	return fresh;
}

/**
 * 最后一条带上还没跟上的 nextUserId，方便下次增量拉取。
 * 前面的用户记录保持接口原样。
 */
function attachResumeCursor(records: IDataObject[], nextUserId: number | undefined): IDataObject[] {
	if (nextUserId === undefined || records.length === 0) return records;
	const lastIndex = records.length - 1;
	return records.map((item, itemIndex) =>
		itemIndex === lastIndex ? { ...item, nextUserId } : item,
	);
}

const operation: ResourceOperations = {
	name: '获取人事信息V3',
	value: 'listV3',
	description: '分页查询 Moka 用户与人事信息',
	action: '',
	order: 10,
	options: [
		{
			displayName:
				'筛选条件均可选。每页最多 500 条。勾选 Return All 后按 nextUserId 取完；未指定排序时会改为从旧到新，这样接口才会返回下一页游标。还没取完时，最后一条会带上 nextUserId，填回起始用户 ID 即可继续。成功码是 0。',
			name: 'noticeListUsersV3',
			type: 'notice',
			default: '',
		},
		paginationOptions.returnAll,
		paginationOptions.limit(MAX_PAGE_SIZE),
		{
			displayName: '筛选条件',
			name: 'filters',
			type: 'collection',
			placeholder: 'Add Filter',
			default: {},
			options: [
				{
					displayName: '用户 ID',
					name: 'userId',
					type: 'string',
					default: '',
					placeholder: '7146923',
					description: 'Moka 用户 ID',
				},
				{
					displayName: '角色 ID',
					name: 'roleId',
					type: 'string',
					default: '',
					placeholder: '105723',
					description: '自定义角色 ID',
				},
				{
					displayName: '邮箱',
					name: 'email',
					type: 'string',
					default: '',
					placeholder: 'name@example.com',
					description: '按邮箱筛选',
				},
				{
					displayName: '电话',
					name: 'phone',
					type: 'string',
					default: '',
					placeholder: '18300000001',
					description: '按电话筛选',
				},
				{
					displayName: '工号',
					name: 'number',
					type: 'string',
					default: '',
					placeholder: '0822002',
					description: '按工号筛选',
				},
				{
					displayName: '禁用状态',
					name: 'deactivated',
					type: 'options',
					default: '0',
					options: [
						{ name: '可用', value: '0' },
						{ name: '禁用', value: '1' },
					],
					description: '0 可用，1 禁用',
				},
				{
					displayName: '部门 ID 类型',
					name: 'departmentIdType',
					type: 'options',
					default: 'DEPARTMENT_ID',
					options: [
						{ name: 'Moka 部门 ID', value: 'DEPARTMENT_ID' },
						{ name: '三方系统部门 ID', value: 'DEPARTMENT_CODE' },
					],
					description: '不传时接口默认按 Moka 部门 ID 解释部门 ID',
				},
				{
					displayName: '部门 ID',
					name: 'departmentId',
					type: 'string',
					default: '',
					placeholder: '3351561',
					description: '用户所属或负责的部门 ID。类型由「部门 ID 类型」决定',
				},
				{
					displayName: '用户语言',
					name: 'locale',
					type: 'options',
					default: 'zh-CN',
					options: [
						{ name: '中文', value: 'zh-CN' },
						{ name: '英文', value: 'en-US' },
					],
					description: '按用户语言筛选。不添加此项则不按语言过滤',
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
					description:
						'按用户创建时间排序。从旧到新时响应会带 nextUserId，适合翻页和增量拉取。不选时接口默认从新到旧',
				},
				{
					displayName: '起始用户 ID',
					name: 'nextUserId',
					type: 'string',
					default: '',
					placeholder: '123321',
					description: '分页或增量拉取的起点。填上次结果最后一条里的 nextUserId',
				},
			],
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			options: [timeoutOption(), batchingOption({ showWhen: { '/returnAll': [true] } })],
		},
	],
	call: async function (index) {
		const returnAll = this.getNodeParameter('returnAll', index, false) as boolean;
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;
		const filters = this.getNodeParameter('filters', index, {}) as IDataObject;

		let query: IUserQuery;
		try {
			query = buildQuery(filters);
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}

		// DESC 不一定返回 nextUserId。全量拉取又没指定排序时改用 ASC，否则 Return All 只能拿到第一页。
		if (returnAll && query.body.order === undefined) {
			query.body.order = 'ASC';
		}

		const requestPage = async (
			cursor: number | undefined,
			pageSize: number,
		): Promise<IUserPage> => {
			const body: IDataObject = { ...query.body, limit: pageSize };
			if (cursor !== undefined) body.nextUserId = cursor;
			const data = await mokaRequest<IUserPage>(this, {
				method: 'POST',
				path: PATH,
				body,
				itemIndex: index,
				timeout,
				successCodes: [0],
			});
			return data ?? {};
		};

		const readPage = (data: IUserPage) => ({
			list: Array.isArray(data.userList) ? data.userList : [],
			nextUserId: readNextUserId(data.nextUserId),
		});

		let limit = Number.POSITIVE_INFINITY;
		if (!returnAll) {
			limit = Number(this.getNodeParameter('limit', index, 50));
			if (!Number.isInteger(limit) || limit < 1) {
				throw new NodeOperationError(this.getNode(), 'Limit 必须是大于等于 1 的整数', {
					itemIndex: index,
				});
			}
		}

		const batchConfig = returnAll ? readBatchConfig.call(this, index) : undefined;
		const perRequestDelay = batchConfig
			? Math.max(1, Math.ceil(batchConfig.batchInterval / Math.max(1, batchConfig.batchSize)))
			: 0;

		const collected: IDataObject[] = [];
		const seenCursors = new Set<number>();
		const seenUserIds = new Set<string>();
		let cursor = query.nextUserId;
		// 因达到 Limit 而没有继续请求的游标。取完时不带回，避免把已用过的起点当成还有数据。
		let resumeCursor: number | undefined;
		let pageIndex = 0;

		while (collected.length < limit) {
			if (cursor !== undefined && seenCursors.has(cursor)) break;
			if (pageIndex > 0 && perRequestDelay > 0) {
				await sleep(perRequestDelay);
			}
			if (cursor !== undefined) seenCursors.add(cursor);

			const pageSize = Math.min(MAX_PAGE_SIZE, limit - collected.length);
			const page = readPage(await requestPage(cursor, pageSize));
			pageIndex += 1;

			const fresh = takeNewUsers(page.list, seenUserIds);
			if (fresh.length === 0) break;

			collected.push(...fresh);
			const nextUserId = page.nextUserId;
			if (nextUserId === undefined || nextUserId === cursor || seenCursors.has(nextUserId)) {
				break;
			}
			if (collected.length >= limit) {
				resumeCursor = nextUserId;
				break;
			}
			cursor = nextUserId;
		}

		const overflow = collected.length > limit;
		const records = overflow ? collected.slice(0, limit) : collected;
		// 接口多返回的用户被截掉时，响应里的 nextUserId 会跳过他们，不能当作增量起点。
		return attachResumeCursor(records, overflow ? undefined : resumeCursor);
	},
};

export default operation;
