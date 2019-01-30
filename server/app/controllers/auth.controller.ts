import { DEV_URL, PROD_URL } from "../config/settings";
import {
  EmailAdreadyRegisteredError,
  InvalidEmailPasswordError,
  MissingRequiredFieldsError,
  NoUserError
} from "./errors/auth.errors";
import { IS_DEBUG, SESSION_DURATION } from "../config/env";

import { SIGNING_KEY } from "../config/secrets";
import Subscribe from "../models/subscribe.model";
import User from "../models/user.model";
import crypto from "crypto";
import moment from "moment";
import nJwt from "njwt";
import { subscribeMailer } from "../mailers";
import { IContext } from "../types/generic";

type TgenerateTokenInput = {
  _id: string;
};

function generateToken(_: null, { _id }: TgenerateTokenInput) {
  const claims = {
    iss: IS_DEBUG ? DEV_URL : PROD_URL, // The URL of your service - update paths in ../config/settings
    sub: _id // The UID of the user in your system - MongoDB _id
  };

  // This is our internal representation of the token, this is not what you'll send to your end user
  const jwt = nJwt.create(claims, SIGNING_KEY);
  jwt.setExpiration(new Date().getTime() + SESSION_DURATION);

  // Base64 URL encoded string that is safe to pass to the browser
  return jwt.compact();
}

type TdeactivateSubscribeTokenInput = {
  email: string;
};

function deactivateSubscribeToken(
  _: null,
  { email }: TdeactivateSubscribeTokenInput
) {
  return Subscribe.findOneAndUpdate(
    { email },
    {
      $set: {
        active: false
      }
    }
  )
    .then(() => {
      return true;
    })
    .catch(error => {
      return error;
    });
}
type TregisterInput = {
  subscribeToken: string;
  firstName: string;
  lastName: string;
  _id: string;
  password: string;
  passwordRepeat: string;
};

async function register(
  _: null,
  {
    subscribeToken,
    firstName,
    lastName,
    _id,
    password,
    passwordRepeat
  }: TregisterInput,
  context: IContext
) {
  if (password !== passwordRepeat) {
    return Error("Passwords do not match");
  }
  if (!firstName || !lastName || !password || !passwordRepeat) {
    throw new MissingRequiredFieldsError({
      data: {
        missing: {
          firstName: !firstName,
          lastName: !lastName,
          password: !password,
          passwordRepeat: !passwordRepeat
        }
      }
    });
  }

  const subscription = await Subscribe.findById(_id)
    .then(data => {
      return data;
    })
    .catch(error => {
      throw error;
    });

  if (!subscription) {
    return Error("You don't exist.");
  }

  if (!subscription.active) {
    return Error("You have already registered. Please login.");
  }

  // Check the subscribeToken to make sure it is valid
  if (subscription.token !== subscribeToken) {
    return Error("Invalid token.");
  }

  // Make sure you already use create here so the password is hashed with Mongoose's pre save middleware
  return User.create({
    email: subscription.email,
    firstName,
    lastName,
    password
  })
    .then(async user => {
      const _id = user._id;
      const token = await generateToken(null, { _id });

      // Change the active param to false on the subscribe token
      deactivateSubscribeToken(_, { email: user.email });

      // Set the token in a cookie
      context.res.cookie("token", token, { maxAge: 3.154e10, httpOnly: true });

      return { token, message: "Successfully registered" };
    })
    .catch(error => {
      return error;
    });
}

type TLoginInput = {
  email: string;
  password: string;
};
async function login(
  _: null,
  { email, password }: TLoginInput,
  context: IContext
) {
  const user = await User.findOne({ email })
    .then(data => {
      return data;
    })
    .catch(error => {
      console.log({ error });
      throw error;
    });

  if (!user) {
    throw new NoUserError({
      data: {
        email
      }
    });
  }

  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    throw new InvalidEmailPasswordError();
  }

  const token = await generateToken(_, { _id: user._id });

  context.res.cookie("token", token, {
    maxAge: SESSION_DURATION,
    httpOnly: true
  });

  return { token };
}

export interface ISubscribeInput {
  email: string;
}

async function subscribe(_: null, { email }: ISubscribeInput) {
  const subscriber = await Subscribe.findOne({ email })
    .then(data => {
      return data;
    })
    .catch(error => {
      throw error;
    });

  const token = crypto.randomBytes(18).toString("hex");
  if (subscriber && !subscriber.active) {
    throw new EmailAdreadyRegisteredError({
      data: {
        email
      }
    });
  }

  const timeSinceLastEmail = subscriber
    ? moment().diff(moment(subscriber.updatedAt), "milliseconds")
    : 9e6;

  // Only let the use send a new email every 15 minutes
  const delayBeforeNewRequest = 15 * 60000;

  if (timeSinceLastEmail <= delayBeforeNewRequest) {
    const timeLeftBeforeNewRequest = delayBeforeNewRequest - timeSinceLastEmail;
    return {
      message: `Confirmation emails can only be sent every ${delayBeforeNewRequest /
        60000} minutes.`
    };
  }

  if (subscriber) {
    return Subscribe.findOneAndUpdate({ _id: subscriber._id }, { token })
      .then(() => {
        subscribeMailer({ email, id: subscriber._id, token });

        return {
          message: `A new confirmation email has been sent to ${email}`
        };
      })
      .catch(error => {
        throw error;
      });
  }

  return Subscribe.create({ email, token })
    .then(data => {
      // Send a verification email to the user
      subscribeMailer({ email, id: data._id, token });

      return { message: `A confirmation email as been sent to ${email}` };
    })
    .catch(error => {
      return error;
    });
}

export default {
  register,
  subscribe,
  login
};