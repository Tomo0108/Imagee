# Converts Real-ESRGAN realesr-general-x4v3.pth (SRVGGNetCompact) to ONNX without torch.
import pickle, zipfile, sys, collections
import numpy as np, onnx
from onnx import helper, numpy_helper, TensorProto

src, dst = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(src)
prefix = z.namelist()[0].split('/')[0]

class Storage:
    def __init__(self, dtype): self.dtype = dtype
def rebuild_tensor_v2(storage, offset, size, stride, *args):
    data, dtype = storage
    arr = np.frombuffer(data, dtype=dtype)
    n = int(np.prod(size)) if size else 1
    a = np.lib.stride_tricks.as_strided(arr[offset:], shape=size, strides=[s * arr.itemsize for s in stride]) if size else arr[offset:offset+1].reshape(())
    return np.array(a)
class U(pickle.Unpickler):
    def find_class(self, mod, name):
        if name == 'FloatStorage': return np.float32
        if name == '_rebuild_tensor_v2': return rebuild_tensor_v2
        if name == 'OrderedDict': return collections.OrderedDict
        if mod.startswith('torch'): return lambda *a, **k: None
        return super().find_class(mod, name)
    def persistent_load(self, pid):
        _, dtype, key, loc, size = pid
        return (z.read(f'{prefix}/data/{key}'), dtype)
state = U(z.open(f'{prefix}/data.pkl')).load()
if 'params' in state: state = state['params']
keys = sorted({int(k.split('.')[1]) for k in state})
print('layers', len(keys))
inits, nodes = [], []
x = 'input'
for i in keys:
    w = state.get(f'body.{i}.weight'); b = state.get(f'body.{i}.bias')
    if w is not None and w.ndim == 4:
        inits += [numpy_helper.from_array(w.astype(np.float32), f'w{i}'), numpy_helper.from_array(b.astype(np.float32), f'b{i}')]
        nodes.append(helper.make_node('Conv', [x, f'w{i}', f'b{i}'], [f'c{i}'], pads=[1, 1, 1, 1], kernel_shape=[3, 3])); x = f'c{i}'
    else:
        inits.append(numpy_helper.from_array(w.reshape(-1, 1, 1).astype(np.float32), f'p{i}'))
        nodes.append(helper.make_node('PRelu', [x, f'p{i}'], [f'a{i}'])); x = f'a{i}'
nodes.append(helper.make_node('DepthToSpace', [x], ['shuffled'], blocksize=4, mode='CRD'))
inits.append(numpy_helper.from_array(np.array([1, 1, 4, 4], np.float32), 'scales'))
nodes.append(helper.make_node('Resize', ['input', '', 'scales'], ['base'], mode='nearest'))
nodes.append(helper.make_node('Add', ['shuffled', 'base'], ['output']))
g = helper.make_graph(nodes, 'srvgg', [helper.make_tensor_value_info('input', TensorProto.FLOAT, [1, 3, 'h', 'w'])],
                      [helper.make_tensor_value_info('output', TensorProto.FLOAT, [1, 3, 'H', 'W'])], inits)
m = helper.make_model(g, opset_imports=[helper.make_opsetid('', 13)]); m.ir_version = 8
onnx.checker.check_model(m); onnx.save(m, dst); print('saved')
