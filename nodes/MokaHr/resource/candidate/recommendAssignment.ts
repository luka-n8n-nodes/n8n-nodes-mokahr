import { IDataObject, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import { requestBatchingOption, timeoutOption } from '../../../help/utils/sharedOptions';

/**
 * 批量推荐用人部门
 * POST /api-platform/batch/recommend/assignment
 * https://www.mokahr.com/docs/api/#-196
 */

const PATH = '/api-platform/batch/recommend/assignment';
const MAX_APPLICATION_IDS = 10;
const MAX_USER_IDS = 20;
const RESUME_TYPES = ['all', 'original', 'standard'] as const;

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

function parseIntegerList(raw: unknown, label: string, maxLength: number): number[] {
	const parts = parseStringList(raw);
	const unique = [...new Set(parts)];
	if (unique.length > maxLength) {
		throw new Error(`${label} 最多 ${maxLength} 个，当前 ${unique.length} 个`);
	}
	return unique.map((part) => {
		if (!/^[1-9]\d*$/.test(part)) {
			throw new Error(`${label} 必须是正整数`);
		}
		const value = Number(part);
		if (!Number.isSafeInteger(value)) {
			throw new Error(`${label} 超出安全整数范围`);
		}
		return value;
	});
}

const operation: ResourceOperations = {
	name: '批量推荐用人部门',
	value: 'recommendAssignment',
	description: '将申请批量推荐给用人部门用户',
	action: '',
	order: 70,
	options: [
		{
			displayName:
				'单次最多 10 个申请、20 个用人部门用户。操作人须对全部申请有推荐或管理权限。申请不存在、已归档或锁冲突时接口可能失败。成功的申请 ID 会拆成多条输出。',
			name: 'noticeRecommendAssignment',
			type: 'notice',
			default: '',
		},
		{
			displayName: '申请 ID 列表',
			name: 'applicationIds',
			type: 'string',
			required: true,
			default: '',
			placeholder: '411250317,411250318',
			description: '申请 ID，去重后最多 10 个。可填写逗号或换行拼接的字符串，或用表达式返回数组',
		},
		{
			displayName: '用人部门用户 ID 列表',
			name: 'assigneeIds',
			type: 'string',
			required: true,
			default: '',
			placeholder: '10001,10002',
			description:
				'被推荐的用人部门用户 ID，去重后最多 20 个。可填写逗号或换行拼接的字符串，或用表达式返回数组',
		},
		{
			displayName: '操作人邮箱',
			name: 'operatorEmail',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'hr@mokahr.com',
			description: '操作人邮箱。操作人必须对所有申请具有推荐或管理权限',
		},
		{
			displayName: '简历类型',
			name: 'resumeType',
			type: 'options',
			default: 'all',
			options: [
				{ name: '全部简历', value: 'all' },
				{ name: '原始简历', value: 'original' },
				{ name: '标准简历', value: 'standard' },
			],
			description: '推荐时附带的简历类型',
		},
		{
			displayName: '抄送用户 ID 列表',
			name: 'carbonCopyUserIds',
			type: 'string',
			default: '',
			placeholder: '10003',
			description: '可选。抄送用户 ID，去重后最多 20 个。留空则不抄送',
		},
		{
			displayName: '备注',
			name: 'message',
			type: 'string',
			default: '',
			placeholder: '请协助筛选候选人',
			description: '可选。推荐时的备注信息',
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			options: [requestBatchingOption, timeoutOption()],
		},
	],
	call: async function (index) {
		const optionsParam = this.getNodeParameter('options', index, {}) as { timeout?: number };
		const timeout = Number(optionsParam.timeout ?? 0) > 0 ? Number(optionsParam.timeout) : 0;
		const resumeType = String(this.getNodeParameter('resumeType', index));
		const operatorEmail = String(this.getNodeParameter('operatorEmail', index, '')).trim();
		const message = String(this.getNodeParameter('message', index, '')).trim();

		let applicationIds: number[];
		let assigneeIds: number[];
		let carbonCopyUserIds: number[];
		try {
			applicationIds = parseIntegerList(
				this.getNodeParameter('applicationIds', index),
				'申请 ID 列表',
				MAX_APPLICATION_IDS,
			);
			assigneeIds = parseIntegerList(
				this.getNodeParameter('assigneeIds', index),
				'用人部门用户 ID 列表',
				MAX_USER_IDS,
			);
			carbonCopyUserIds = parseIntegerList(
				this.getNodeParameter('carbonCopyUserIds', index, ''),
				'抄送用户 ID 列表',
				MAX_USER_IDS,
			);
			if (applicationIds.length === 0) {
				throw new Error('申请 ID 列表不能为空');
			}
			if (assigneeIds.length === 0) {
				throw new Error('用人部门用户 ID 列表不能为空');
			}
			if (!operatorEmail) {
				throw new Error('操作人邮箱不能为空');
			}
			if (!RESUME_TYPES.includes(resumeType as (typeof RESUME_TYPES)[number])) {
				throw new Error('简历类型只能是全部简历、原始简历或标准简历');
			}
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}

		const body: IDataObject = {
			applicationIds,
			assigneeIds,
			operatorEmail,
			resumeType,
		};
		if (carbonCopyUserIds.length > 0) body.carbonCopyUserIds = carbonCopyUserIds;
		if (message) body.message = message;

		const data = await mokaRequest<number[]>(this, {
			method: 'POST',
			path: PATH,
			body,
			itemIndex: index,
			timeout,
		});

		if (!Array.isArray(data)) return [];
		return data.map((applicationId) => ({ applicationId }));
	},
};

export default operation;
