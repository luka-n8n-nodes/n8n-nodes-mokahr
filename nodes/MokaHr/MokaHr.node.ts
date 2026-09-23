import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
} from 'n8n-workflow';
import ResourceFactory from '../help/builder/ResourceFactory';
import { Credentials } from '../help/type/enums';
import { OperationCallFunction } from '../help/type/IResource';

const resourceBuilder = ResourceFactory.build(__dirname);

interface IRequestBatchConfig {
	batchSize: number;
	batchInterval: number;
}

interface IRequestResult {
	itemIndex: number;
	result?: IDataObject | IDataObject[];
	error?: unknown;
}

/**
 * 读取输入条目批处理。结构是 options.batching.batch，与分页用的 options.batching.config 分开。
 * 未添加 Batching 时返回 undefined，执行保持串行。
 */
function getRequestBatchConfig(context: IExecuteFunctions): IRequestBatchConfig | undefined {
	try {
		const options = context.getNodeParameter('options', 0, {}) as {
			batching?: { batch?: { batchSize?: number; batchInterval?: number } };
		};
		const batch = options?.batching?.batch;
		if (batch === undefined) return undefined;

		const batchSize = batch.batchSize ?? 50;
		const batchInterval = batch.batchInterval ?? 0;
		return {
			batchSize: batchSize === 0 ? 1 : batchSize,
			batchInterval,
		};
	} catch {
		return undefined;
	}
}

function toExecutionData(
	context: IExecuteFunctions,
	responseData: IDataObject | IDataObject[],
	itemIndex: number,
): INodeExecutionData[] {
	return context.helpers.constructExecutionMetaData(context.helpers.returnJsonArray(responseData), {
		itemData: { item: itemIndex },
	});
}

function toErrorData(
	context: IExecuteFunctions,
	error: unknown,
	itemIndex: number,
): INodeExecutionData[] {
	return context.helpers.constructExecutionMetaData(
		context.helpers.returnJsonArray({
			error: error instanceof Error ? error.message : String(error),
		}),
		{ itemData: { item: itemIndex } },
	);
}

function rethrow(context: IExecuteFunctions, error: unknown): never {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		throw error;
	}
	throw new NodeApiError(context.getNode(), (error ?? {}) as JsonObject, {
		message: error instanceof Error ? error.message : String(error),
	});
}

async function executeSerial(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
	callFunc: OperationCallFunction,
): Promise<INodeExecutionData[][]> {
	const returnData: INodeExecutionData[][] = [[]];

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			const responseData = await callFunc.call(context, itemIndex);
			returnData[0].push(...toExecutionData(context, responseData as IDataObject, itemIndex));
		} catch (error) {
			if (context.continueOnFail()) {
				returnData[0].push(...toErrorData(context, error, itemIndex));
				continue;
			}
			rethrow(context, error);
		}
	}

	return returnData;
}

/**
 * 与飞书节点相同：同一批里的请求同时发出，下一批开始前等待 Batch Interval。
 * 结果仍按输入顺序输出。
 */
async function executeParallel(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
	callFunc: OperationCallFunction,
	batchConfig: IRequestBatchConfig,
): Promise<INodeExecutionData[][]> {
	const { batchSize, batchInterval } = batchConfig;
	const requestPromises: Array<Promise<IRequestResult>> = [];

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		if (itemIndex > 0 && batchSize > 0 && batchInterval > 0 && itemIndex % batchSize === 0) {
			await sleep(batchInterval);
		}

		const requestPromise = callFunc
			.call(context, itemIndex)
			.then(
				(result): IRequestResult => ({ itemIndex, result: result as IDataObject | IDataObject[] }),
			)
			.catch((error: unknown): IRequestResult => ({ itemIndex, error }));
		requestPromises.push(requestPromise);
	}

	const responses = await Promise.all(requestPromises);
	const returnData: INodeExecutionData[][] = [[]];

	for (const { itemIndex, result, error } of responses) {
		if (error) {
			if (context.continueOnFail()) {
				returnData[0].push(...toErrorData(context, error, itemIndex));
				continue;
			}
			rethrow(context, error);
		}
		if (result === undefined) continue;
		returnData[0].push(...toExecutionData(context, result, itemIndex));
	}

	return returnData;
}

export class MokaHr implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Moka Hr',
		name: 'mokaHr',
		subtitle: '={{ $parameter.resource }}:{{ $parameter.operation }}',
		icon: 'file:icon.svg',
		group: ['transform'],
		version: [1],
		defaultVersion: 1,
		description: 'Moka Hr 招聘 Open API 集成',
		defaults: {
			name: 'Moka Hr',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: Credentials.MokaHrApi,
				required: true,
			},
		],
		properties: [...resourceBuilder.build()],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		const callFunc = resourceBuilder.getCall(resource, operation);

		if (!callFunc) {
			throw new NodeOperationError(this.getNode(), `未实现方法: ${resource}.${operation}`);
		}

		const batchConfig = getRequestBatchConfig(this);
		if (batchConfig) {
			return executeParallel(this, items, callFunc, batchConfig);
		}

		return executeSerial(this, items, callFunc);
	}
}
