import { IDataObject, NodeOperationError } from 'n8n-workflow';
import { ResourceOperations } from '../../../help/type/IResource';
import { mokaRequest } from '../../../help/utils/MokaRequest';
import { requestBatchingOption, timeoutOption } from '../../../help/utils/sharedOptions';

/**
 * 根据申请 Id 批量获取候选人信息
 * POST /api-platform/v3/data/getApplictaions
 * https://www.mokahr.com/docs/api/#id-5
 *
 * 路径按文档原文拼写为 getApplictaions。
 */

const PATH = '/api-platform/v3/data/getApplictaions';
const MAX_ID_LIST_LENGTH = 20;

interface IApplicationListData {
	applicationList?: IDataObject[];
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

function parseIntegerList(raw: unknown, label: string, maxLength: number): number[] {
	const parts = parseStringList(raw);
	if (parts.length > maxLength) {
		throw new Error(`${label} 最多 ${maxLength} 个，当前 ${parts.length} 个`);
	}
	return parts.map((part) => {
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
	name: '根据申请ID批量获取候选人信息',
	value: 'getByApplicationIds',
	description: '根据申请 ID 批量获取候选人基础信息和详细信息',
	action: '',
	order: 25,
	options: [
		{
			displayName:
				'申请 ID 必填，最多 20 个。每条申请输出一项，包含候选人基础信息 candidateBaseInfo 和详细信息 candidateInfo。头像链接 portraitUrl 默认一天有效。',
			name: 'noticeGetByApplicationIds',
			type: 'notice',
			default: '',
		},
		{
			displayName: '申请 ID 列表',
			name: 'applicationIds',
			type: 'string',
			required: true,
			default: '',
			placeholder: '411348665,411274410',
			description: '申请 ID，最多 20 个。可填写逗号或换行拼接的字符串，或用表达式返回数组',
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

		let applicationIds: number[];
		try {
			applicationIds = parseIntegerList(
				this.getNodeParameter('applicationIds', index),
				'申请 ID 列表',
				MAX_ID_LIST_LENGTH,
			);
			if (applicationIds.length === 0) {
				throw new Error('申请 ID 列表不能为空');
			}
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}

		const data = await mokaRequest<IApplicationListData>(this, {
			method: 'POST',
			path: PATH,
			body: { applicationIds },
			itemIndex: index,
			timeout,
		});

		return Array.isArray(data?.applicationList) ? data.applicationList : [];
	},
};

export default operation;
