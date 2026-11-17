import type { ContributionGraphConfig } from "../types";
import type { GraphRender } from "./graphRender";
import { ActivityTimelineView } from "../view/ActivityTimelineView";

export class ActivityTimelineGraphRender implements GraphRender {
 private views=new WeakMap<HTMLElement,ActivityTimelineView>();
 graphType():string {return "timeline";}
 render(container:HTMLElement,config:ContributionGraphConfig):void {
  if(!config.activityTimeline)throw new Error("学习时间轴需要活跃时长服务");
  const root=container.createDiv({cls:"contribution-graph cg-activity-timeline-graph"});
  const main=root.createDiv({cls:"main cg-activity-timeline-surface"});
  if(config.mainContainerStyle)Object.assign(main.style,config.mainContainerStyle);
  this.views.set(container,new ActivityTimelineView(main,config.activityTimeline));
 }
 update(container:HTMLElement,config:ContributionGraphConfig):boolean {
  const view=this.views.get(container);
  if(!view||!config.activityTimeline)return false;
  view.update(config.activityTimeline);return true;
 }
 dispose(container:HTMLElement):void {this.views.get(container)?.dispose();this.views.delete(container);}
}
