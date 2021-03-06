import { IResolvers } from 'apollo-server-express';
import { IS_DEBUG } from '../../config/env';
import authMutations from './auth.mutations';
import authQueries from './auth.queries';
import userMutations from './user.mutations';
import userQueries from './user.queries';

type TObject = {
  resolveType: string;
}

const resolvers = {
  Node: {
    __resolveType(obj: TObject) {
      if (obj.resolveType) {
        return obj.resolveType;
      }
      if (IS_DEBUG) {
        // TODO Make this an apollo error and pass the obj to the data object
        throw new Error('Undefined resolve type for type Node');
      }
      return null;
    }
  },
  Subscription: {},
  Mutation:  {
    ...authMutations,
    ...userMutations
  } as IResolvers,
  Query: {
    ...authQueries,
    ...userQueries
  }
};

export default resolvers;