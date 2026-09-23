import { INodePropertyOptions, INodeProperties, NodePropertyTypes } from 'n8n-workflow';
import {
	IResource,
	ResourceOperations,
	OperationCallFunction,
	ResourceOptionWithoutOperations,
	OperationOptionWithoutDetails,
} from '../type/IResource';

/**
 * 资源构建器：用于构建 n8n 节点的 resource/operation 结构。
 *
 * operation 未单独设置 action 时，用操作名称作为 action。
 * n8n 用 action 生成节点标题；为空时会退回成「操作值 资源值」。
 */
class ResourceBuilder {
	private resources: IResource[] = [];

	addResource(resource: INodePropertyOptions): void {
		this.resources.push({
			...resource,
			operations: [],
		});
	}

	addOperate(resourceName: string, operate: ResourceOperations): void {
		const resource = this.resources.find((r) => r.value === resourceName);
		if (resource) {
			resource.operations.push(operate);
		}
	}

	build(): INodeProperties[] {
		const properties: INodeProperties[] = [];

		properties.push(this.buildResourceProperty());

		for (const resource of this.resources) {
			if (resource.operations.length === 0) continue;

			properties.push(this.buildOperationProperty(resource));
			properties.push(...this.buildOperationOptions(resource));
		}

		return properties;
	}

	private buildResourceProperty(): INodeProperties {
		const resourceOptions: ResourceOptionWithoutOperations[] = this.resources.map((item) => ({
			...item,
			description: item.description || '',
			action: item.action ?? '',
			operations: null,
		}));

		return {
			displayName: 'Resource',
			name: 'resource',
			type: 'options' as NodePropertyTypes,
			noDataExpression: true,
			options: resourceOptions as INodePropertyOptions[],
			default: '',
		};
	}

	private buildOperationProperty(resource: IResource): INodeProperties {
		const operationOptions: OperationOptionWithoutDetails[] = resource.operations.map((item) => ({
			...item,
			description: item.description || '',
			action: item.action || item.name,
			options: null,
			call: undefined,
			order: undefined,
		}));

		return {
			displayName: 'Operation',
			name: 'operation',
			type: 'options' as NodePropertyTypes,
			noDataExpression: true,
			displayOptions: {
				show: {
					resource: [resource.value],
				},
			},
			options: operationOptions as INodePropertyOptions[],
			default: '',
		};
	}

	private buildOperationOptions(resource: IResource): INodeProperties[] {
		const options: INodeProperties[] = [];

		for (const operation of resource.operations) {
			for (const option of operation.options) {
				const mergedDisplayOptions = {
					...option.displayOptions,
					show: {
						...option.displayOptions?.show,
						resource: [resource.value],
						operation: [operation.value],
					},
				};

				options.push({
					...option,
					displayOptions: mergedDisplayOptions,
				});
			}
		}

		return options;
	}

	getCall(resourceName: string, operateName: string): OperationCallFunction | undefined {
		const resource = this.resources.find((item) => item.value === resourceName);
		if (!resource) {
			return undefined;
		}

		const operate = resource.operations.find((item) => item.value === operateName);
		return operate?.call;
	}
}

export default ResourceBuilder;
