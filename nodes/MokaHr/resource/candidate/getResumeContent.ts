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
 * 根据申请 ID 获取简历解析文本
 * POST /api-platform/application/resumeContent/get
 * https://www.mokahr.com/docs/api/#id-3
 */

const PATH = '/api-platform/application/resumeContent/get';

function parseApplicationId(raw: unknown): number {
	if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) {
		return raw;
	}

	const text = String(raw ?? '').trim();
	if (!/^[1-9]\d*$/.test(text)) {
		throw new Error('申请 ID 必须是正整数');
	}

	const value = Number(text);
	if (!Number.isSafeInteger(value)) {
		throw new Error('申请 ID 超出安全整数范围');
	}
	return value;
}

const operation: ResourceOperations = {
	name: '获取简历解析文本',
	value: 'getResumeContent',
	description: '根据申请 ID 获取原始简历的解析文本',
	action: '',
	order: 30,
	options: [
		{
			displayName: '返回原始简历 key 和解析后的纯文本。',
			name: 'noticeGetResumeContent',
			type: 'notice',
			default: '',
		},
		{
			displayName: '申请 ID',
			name: 'applicationId',
			type: 'string',
			required: true,
			default: '',
			placeholder: '411348665',
			description: '申请 ID。可填写数字，或用表达式返回数字、字符串',
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

		let applicationId: number;
		try {
			applicationId = parseApplicationId(this.getNodeParameter('applicationId', index));
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error.message : String(error),
				{ itemIndex: index },
			);
		}

		const data = await mokaRequest<IDataObject>(this, {
			method: 'POST',
			path: PATH,
			body: { applicationId },
			itemIndex: index,
			timeout,
			proxy,
		});

		return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
	},
};

export default operation;
