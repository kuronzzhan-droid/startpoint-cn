package pinball.common.tools._FunctionTools
{
   import flash.Boot;

   public class BindImpl2_0
   {

      public var func:Function;

      public var arg2:Object;

      public var arg1:Object;

      public function BindImpl2_0(param1:Function = undefined, param2:Object = undefined, param3:Object = undefined)
      {
         if(Boot.skip_constructor)
         {
            return;
         }
         arg1 = param2;
         arg2 = param3;
         func = param1;
      }

      public function execute() : Object
      {
         return func(arg1,arg2);
      }
   }
}
