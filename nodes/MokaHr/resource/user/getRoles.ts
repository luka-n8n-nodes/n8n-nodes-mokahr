import { IDataObject, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import {
	proxyOption,
	readRequestOptions,
	requestBatchingOption,
	timeoutOption,
} from '../../../help/utils/sharedOptions';

/**
 * 查询角色信息
 * GET /api-platform/v1/users/roles
 * https://www.mokahr.com/docs/api/
 *
 * 示例响应没有业务 code，用 success 表示是否成功，角色在 data 数组里。
 */

const PATH = '/api-platform/v1/users/roles';
const ROLE_TYPES = ['all', 'custom', 'builtin'] as const;
type RoleType = (typeof ROLE_TYPES)[number];

interface IRoleListResponse {
	success?: boolean;
	code?: number;
	msg?: string;
	message?: string;
	data?: IDataObject[];
}

function parseRoleType(raw: unknown): RoleType {
	const text = String(raw ?? '')
		.trim()
		.toLowerCase();
	const matched = ROLE_TYPES.find((item) => item === text);
	if (!matched) {
		throw new Error('查询类型只能是全部、自定义或内建');
	}
	return matched;
}

function readRoleList(response: unknown): IDataObject[] {
	if (Array.isArray(response)) return response as IDataObject[];
	if (!response || typeof response !== 'object') return [];

	const body = response as IRoleListResponse;
	if (body.success === false) {
		throw new Error(body.msg || body.message || '查询角色信息失败');
	}
	return Array.isArray(body.data) ? body.data : [];
}

const operation: ResourceOperations = {
	name: '查询角色信息',
	value: 'getRoles',
	description: '查询当前客户下的用户角色',
	action: '',
	order: 20,
	options: [
		{
			displayName: '返回当前客户下的用户角色。每条角色输出一项，包含角色 ID、名称、角色值和描述。',
			name: 'noticeGetRoles',
			type: 'notice',
			default: '',
		},
		{
			displayName: '查询类型',
			name: 'type',
			type: 'options',
			default: 'all',
			options: [
				{ name: '全部', value: 'all' },
				{ name: '自定义', value: 'custom' },
				{ name: '内建', value: 'builtin' },
			],
			description: '全部为 all，自定义为 custom，内建为 builtin',
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			options: [requestBatchingOption, timeoutOption(), proxyOption],
		},
	],
	call: async function (index) {
		const { timeout, proxy } = readRequestOptions.call(this, index);

		let type: RoleType;
		try {
			type = parseRoleType(this.getNodeParameter('type', index));
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}

		const response = await mokaRequest<IRoleListResponse | IDataObject[]>(this, {
			method: 'GET',
			path: `${PATH}?type=${type}`,
			itemIndex: index,
			timeout,
			proxy,
			returnFullResponse: true,
			successCodes: [0, 200],
		});

		try {
			return readRoleList(response);
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}
	},
};

export default operation;
