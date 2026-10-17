"""Publish verified workspace artifacts without rewriting identical files."""
import os
import shutil

from build_common import ROOT
from release_history import digest


def publish(source, destination):
    assert source.resolve().is_relative_to(ROOT.resolve())
    assert destination.resolve().is_relative_to(ROOT.resolve())
    if destination.is_file() and digest(source) == digest(destination):
        return
    temporary = destination.with_name(destination.name + '.new')
    shutil.copyfile(source, temporary)
    os.replace(temporary, destination)
