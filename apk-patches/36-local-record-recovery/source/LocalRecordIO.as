package cn.storage {
    import flash.errors.IOError;
    import flash.filesystem.File;
    import flash.filesystem.FileMode;
    import flash.filesystem.FileStream;
    import flash.utils.ByteArray;

    /** Used only by the existing account/device record writers. */
    public final class LocalRecordIO {
        public static function writeBinaryFile(file:File, bytes:Object):void {
            var data:ByteArray=bytes ? bytes.b as ByteArray : null;
            if(!file || !data || data.length==0)throw new IOError("Local record data is empty.");
            if(file.exists && file.isDirectory)throw new IOError("Local record target is a directory.");
            var parent:File=file.parent;
            parent.createDirectory();
            var pending:File=parent.resolvePath(file.name+".sp-write");
            var stream:FileStream=new FileStream();
            try {
                // Keep the original until the complete new payload is closed.
                // A sibling path keeps the final replacement on the same volume.
                stream.open(pending,FileMode.WRITE);
                stream.writeBytes(data,0,data.length);
                stream.close();
                if(pending.size!=data.length)throw new IOError("Local record write was incomplete.");
                pending.moveTo(file,true);
            } catch(error:*) {
                try {stream.close();}catch(closeError:*){}
                try {if(pending.exists && !pending.isDirectory)pending.deleteFile();}catch(cleanupError:*){}
                throw error;
            }
        }
    }
}
