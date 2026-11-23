export const majorRecordPattern=/人员分工|人员调配申请|采购申请|采购订单|物资需求|领料.*(?:申请|单)|出库申请|付款申请|支出申请|报销|合同|设备使用与租赁申请|设计变更申请|方案变更|签证申请/;
export function reviewMode(table:any):'supervisor'|'approval'{return table.review_mode|| (majorRecordPattern.test(table.name||'')?'approval':'supervisor');}
export function editableRecord(table:any,status:string){return ['draft','rejected'].includes(status)||(reviewMode(table)==='supervisor'&&status==='approved');}
