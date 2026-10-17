package pinball.common.tools._FunctionTools
{
   import flash.Boot;

   public class BindImpl1_0
   {

      public var func:Function;

      public var arg1:Object;

      public function BindImpl1_0(param1:Function = undefined, param2:Object = undefined)
      {
         if(Boot.skip_constructor)
         {
            return;
         }
         arg1 = param2;
         func = param1;
      }

      public function execute() : Object
      {
         return func(arg1);
      }
   }
}
