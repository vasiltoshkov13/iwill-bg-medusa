import { Module } from '@medusajs/framework/utils';

import Nis2ModuleService from './service';

export const NIS2_MODULE = 'nis2';

export default Module(NIS2_MODULE, {
  service: Nis2ModuleService,
});
