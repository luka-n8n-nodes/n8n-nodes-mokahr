import {
	IDataObject,
	INodeProperties,
	INodePropertyOptions,
	type IExecuteFunctions,
} from 'n8n-workflow';

/**
 * 操作返回结果类型
 */
export type OperationResult = IDataObject | IDataObject[];

/**
 * 操作调用函数类型
 */
export type OperationCallFunction = (
	this: IExecuteFunctions,
	index: number,
) => Promise<OperationResult>;

/**
 * 资源操作定义
 */
export type ResourceOperations = INodePropertyOptions & {
	options: INodeProperties[];
	call?: OperationCallFunction;
	order?: number;
};

/**
 * 资源选项定义
 */
export type ResourceOptions = INodePropertyOptions & {
	order?: number;
};

/**
 * 资源接口定义
 */
export interface IResource extends INodePropertyOptions {
	operations: ResourceOperations[];
}

/**
 * 资源选项（用于构建节点属性时移除 operations）
 */
export type ResourceOptionWithoutOperations = Omit<IResource, 'operations'> & {
	operations: null;
};

/**
 * 操作选项（用于构建节点属性时移除 options 和 call）
 */
export type OperationOptionWithoutDetails = Omit<ResourceOperations, 'options' | 'call'> & {
	options: null;
};
