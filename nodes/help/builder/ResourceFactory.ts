import ResourceBuilder from './ResourceBuilder';
import { ResourceOperations, ResourceOptions } from '../type/IResource';
import ModuleLoadUtils from '../utils/ModuleLoadUtils';

class ResourceFactory {
	static build(basedir: string): ResourceBuilder {
		const resourceBuilder = new ResourceBuilder();
		const resources: ResourceOptions[] = ModuleLoadUtils.loadModules(basedir, 'resource/*.js');
		resources.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
		resources.forEach((resource) => {
			resourceBuilder.addResource(resource);
			const operates: ResourceOperations[] = ModuleLoadUtils.loadModules(
				basedir,
				`resource/${resource.value}/*.js`,
			);
			operates.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
			operates.forEach((operate: ResourceOperations) => {
				// @ts-expect-error dynamic resource value
				resourceBuilder.addOperate(resource.value, operate);
			});
		});
		return resourceBuilder;
	}
}

export default ResourceFactory;
