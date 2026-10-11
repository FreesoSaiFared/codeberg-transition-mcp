import {planMigration} from './plan.mjs';
import {executeMigration} from './execute.mjs';
import {readPlan,summarize} from './store.mjs';
export class MigrationPlanner {
  constructor(api,directory){this.api=api;this.directory=directory;}
  preview(options){return planMigration(this.api,this.directory,options);}
  async status(id){return summarize(await readPlan(this.directory,id));}
  execute(options){return executeMigration(this.api,this.directory,options);}
}
