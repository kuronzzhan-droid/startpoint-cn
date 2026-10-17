package cn.optimize.tests {
 public class TableOrderProbe {
  private var owner:TableProbe;
  public function TableOrderProbe(value:TableProbe){owner=value;}
  tableOrder function present(data:Array):void{owner.presentation=JSON.stringify(data);}
 }
}
