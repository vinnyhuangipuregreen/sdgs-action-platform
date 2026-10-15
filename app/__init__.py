import os, sys, importlib.util

def _ensure_module(subname):
    full_name = f"app.{subname}"
    if full_name not in sys.modules:
        p = os.path.join(os.path.dirname(__file__), f"{subname}.py")
        if os.path.exists(p):
            spec = importlib.util.spec_from_file_location(full_name, p)
            mod = importlib.util.module_from_spec(spec)
            sys.modules[full_name] = mod
            spec.loader.exec_module(mod)
            return mod
    return sys.modules.get(full_name)

database = _ensure_module("database")
auth = _ensure_module("auth")
docx_exporter = _ensure_module("docx_exporter")
mailer = _ensure_module("mailer")
sdgs_check = _ensure_module("sdgs_check")
main = _ensure_module("main")
