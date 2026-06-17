import numpy as np

# ADOpy 0.4.1 still references NumPy aliases removed in modern NumPy.
if not hasattr(np, "int"):
    np.int = int
if not hasattr(np, "float"):
    np.float = float

from adopy import Engine
from adopy.tasks.dd import ModelHyp, TaskDD


N_TRIAL = 42


def get_default_grid_design():
    return {
        "t_ss": [0],
        "t_ll": [
            0.43, 0.714, 1, 2, 3,
            4.3, 6.44, 8.6, 10.8, 12.9,
            17.2, 21.5, 26, 52, 104,
            156, 260, 520,
        ],
        "r_ss": np.arange(12.5, 800, 12.5),
        "r_ll": [800],
    }


def get_default_grid_param():
    return {
        "k": np.logspace(-5, 0, 50, base=10),
        "tau": np.linspace(0, 5, 11)[1:],
    }


def get_default_grid_response():
    return {"choice": [0, 1]}


def to_float_dict(values):
    return {key: float(value) for key, value in values.items()}


def clean_design(design):
    return {key: float(value) for key, value in dict(design).items()}


class DelayDiscountingSession:
    def __init__(self, grid_design=None, grid_param=None):
        task = TaskDD()
        model = ModelHyp()
        self.engine = Engine(
            task,
            model,
            grid_design or get_default_grid_design(),
            grid_param or get_default_grid_param(),
            get_default_grid_response(),
        )
        self.session_id = None
        self.trial_index = 0
        self.next_design = clean_design(self.engine.get_design("optimal"))

    def summary(self):
        return {
            "session_id": self.session_id,
            "trial_index": self.trial_index,
            "next_design": self.next_design,
            "post_mean": to_float_dict(self.engine.post_mean.to_dict()),
            "post_sd": to_float_dict(self.engine.post_sd.to_dict()),
        }

    def update(self, design, response):
        self.engine.update(clean_design(design), {"choice": int(response["choice"])})
        self.trial_index += 1
        self.next_design = clean_design(self.engine.get_design("optimal"))
        return self.summary()
